import { Inject, Injectable, Logger } from '@nestjs/common';
import { auditLogs, blockchainTransactions, events, ticketTiers, tickets, users } from '@ticketpay/database';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { ChainClient } from './chain.client';

/** Thrown when the job should simply run again later, for example while a transaction is still pending. */
export class RetryLaterError extends Error {}

export type MintResult = 'minted' | 'recovered' | 'already-minted' | 'skipped' | 'missing';

/**
 * Mints the NFT for one issued ticket. Runs only from the chain queue (concurrency 1, so one nonce at a time),
 * and only for tickets created by a backend-verified PAID payment: there is no other way into this queue.
 *
 * Every step is safe to repeat. The contract rejects a second mint for the same payment reference,
 * and before sending anything this checks for an earlier transaction and for an existing token.
 */
@Injectable()
export class MintService {
  private readonly log = new Logger('Mint');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
  ) {}

  async processMint(ticketId: string): Promise<MintResult> {
    const [row] = await this.db
      .select({
        ticket: tickets,
        onChainEventId: events.onChainEventId,
        eventDbId: events.id,
        tierCode: ticketTiers.tierCode,
        custodialAddress: users.custodialAddress,
      })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .innerJoin(users, eq(tickets.ownerId, users.id))
      .where(eq(tickets.id, ticketId));
    if (!row) return 'missing';
    const { ticket } = row;
    if (ticket.mintStatus === 'MINTED') return 'already-minted';
    // A ticket refunded or cancelled before it reached the chain is never minted. One already admitted
    // at the gate still is: it was paid for, and its on-chain redeem waits for this mint.
    if (ticket.status === 'CANCELLED' || ticket.status === 'EXPIRED') return 'skipped';
    const chainId = this.chain.config.chainId!;

    // 1. An earlier attempt that got as far as sending a transaction.
    const [previous] = await this.db
      .select()
      .from(blockchainTransactions)
      .where(and(eq(blockchainTransactions.ticketId, ticketId), eq(blockchainTransactions.type, 'MINT'), eq(blockchainTransactions.status, 'SUBMITTED')))
      .orderBy(desc(blockchainTransactions.createdAt))
      .limit(1);
    if (previous?.txHash) {
      const found = await this.chain.lookup(previous.txHash);
      if (found === 'pending') throw new RetryLaterError(`Mint transaction ${previous.txHash} is still pending`);
      if (found !== 'missing' && found.status === 1) {
        const minted = this.chain.mintedLog(found);
        if (minted) {
          await this.markMinted(ticketId, previous.id, minted.tokenId, found.blockNumber);
          return 'recovered';
        }
      }
      await this.failTx(previous.id, found === 'missing' ? 'Transaction dropped from the mempool' : 'Transaction reverted');
    }

    // 2. Already on-chain, for example the process stopped right after sending.
    const existing = await this.chain.tokenIdByPaymentRef(ticket.paymentRefHash);
    if (existing > 0n) {
      await this.recordRecovered(ticketId, existing, chainId);
      return 'recovered';
    }

    // 3. The buyer's custodial address, derived once and stored.
    const to = row.custodialAddress ?? (await this.assignCustodialAddress(ticket.ownerId));

    // 4. The contract enforces a per-event supply, kept equal to the sum of the event's tier quotas.
    await this.ensureSupply(row.eventDbId, row.onChainEventId, chainId);

    // 5. Send the mint.
    const [txRow] = await this.db.insert(blockchainTransactions).values({ type: 'MINT', ticketId, eventId: row.eventDbId, chainId, status: 'QUEUED' }).returning();
    let sent;
    try {
      sent = await this.chain.sendMint(to, row.onChainEventId, row.tierCode, ticket.paymentRefHash);
    } catch (err) {
      const reason = this.chain.revertName(err);
      if (reason === 'PaymentRefAlreadyUsed') {
        await this.failTx(txRow.id, 'Already minted by an earlier transaction');
        const tokenId = await this.chain.tokenIdByPaymentRef(ticket.paymentRefHash);
        await this.recordRecovered(ticketId, tokenId, chainId);
        return 'recovered';
      }
      await this.failTx(txRow.id, this.chain.errorText(err));
      throw err;
    }
    await this.db.update(blockchainTransactions).set({ status: 'SUBMITTED', txHash: sent.hash }).where(eq(blockchainTransactions.id, txRow.id));
    await this.db.update(tickets).set({ mintStatus: 'SUBMITTED' }).where(eq(tickets.id, ticketId));

    const receipt = await this.chain.waitFor(sent);
    if (!receipt) throw new RetryLaterError(`Mint transaction ${sent.hash} not confirmed yet`);
    if (receipt.status !== 1) {
      await this.failTx(txRow.id, 'Transaction reverted');
      throw new Error(`Mint transaction ${sent.hash} reverted`);
    }
    const minted = this.chain.mintedLog(receipt);
    if (!minted) throw new Error(`Mint transaction ${sent.hash} has no TicketMinted event`);
    await this.markMinted(ticketId, txRow.id, minted.tokenId, receipt.blockNumber);
    this.log.log(`Minted token ${minted.tokenId} for ticket ${ticketId} (tx ${sent.hash})`);
    return 'minted';
  }

  /** Called after the last retry fails. The sweep tries FAILED tickets again later. */
  async markFailed(ticketId: string, message: string) {
    await this.db
      .update(tickets)
      .set({ mintStatus: 'FAILED' })
      .where(and(eq(tickets.id, ticketId), or(eq(tickets.mintStatus, 'PENDING'), eq(tickets.mintStatus, 'SUBMITTED'))));
    await this.db.insert(auditLogs).values({ actorRole: 'SYSTEM', action: 'ticket.mint_failed', entityType: 'Ticket', entityId: ticketId, metadata: { message: message.slice(0, 300) } });
  }

  /**
   * Tickets whose mint job may be lost or that failed a while ago. Re-adding a job that is still
   * queued is a no-op (same job id), and the contract refuses double mints, so this is always safe.
   */
  async ticketsToSweep(now = new Date()): Promise<string[]> {
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          inArray(tickets.status, ['ACTIVE', 'REDEEMED']),
          or(
            and(inArray(tickets.mintStatus, ['PENDING', 'SUBMITTED']), lt(tickets.createdAt, new Date(now.getTime() - 60_000))),
            and(eq(tickets.mintStatus, 'FAILED'), lt(tickets.updatedAt, new Date(now.getTime() - 10 * 60_000))),
          ),
        ),
      )
      .limit(200);
    return rows.map((r) => r.id);
  }

  private async assignCustodialAddress(userId: string): Promise<string> {
    const address = this.chain.custodialAddress(userId);
    await this.db.update(users).set({ custodialAddress: address }).where(and(eq(users.id, userId), isNull(users.custodialAddress)));
    return address;
  }

  private async ensureSupply(eventDbId: string, onChainEventId: number, chainId: number) {
    const [{ total }] = await this.db
      .select({ total: sql<number>`coalesce(sum(${ticketTiers.quota}), 0)::int` })
      .from(ticketTiers)
      .where(eq(ticketTiers.eventId, eventDbId));
    const current = await this.chain.maxSupply(onChainEventId);
    if (current >= BigInt(total)) return;
    const [txRow] = await this.db.insert(blockchainTransactions).values({ type: 'SET_SUPPLY', eventId: eventDbId, chainId, status: 'QUEUED' }).returning();
    try {
      const sent = await this.chain.sendSetEventSupply(onChainEventId, total);
      await this.db.update(blockchainTransactions).set({ status: 'SUBMITTED', txHash: sent.hash }).where(eq(blockchainTransactions.id, txRow.id));
      const receipt = await this.chain.waitFor(sent);
      if (!receipt) throw new RetryLaterError(`Supply transaction ${sent.hash} not confirmed yet`);
      if (receipt.status !== 1) throw new Error(`Supply transaction ${sent.hash} reverted`);
      await this.db.update(blockchainTransactions).set({ status: 'CONFIRMED', blockNumber: receipt.blockNumber }).where(eq(blockchainTransactions.id, txRow.id));
      this.log.log(`Event ${onChainEventId} supply set to ${total} on-chain`);
    } catch (err) {
      if (!(err instanceof RetryLaterError)) await this.failTx(txRow.id, this.chain.errorText(err));
      throw err;
    }
  }

  private async markMinted(ticketId: string, txRowId: string | null, tokenId: bigint, blockNumber: number | null) {
    await this.db.transaction(async (tx) => {
      if (txRowId) await tx.update(blockchainTransactions).set({ status: 'CONFIRMED', blockNumber, errorMessage: null }).where(eq(blockchainTransactions.id, txRowId));
      await tx.update(tickets).set({ tokenId: tokenId.toString(), mintStatus: 'MINTED' }).where(eq(tickets.id, ticketId));
    });
  }

  /** The token exists but this process never saw its receipt. Recorded without a transaction hash. */
  private async recordRecovered(ticketId: string, tokenId: bigint, chainId: number) {
    const [t] = await this.db.select({ eventId: tickets.eventId }).from(tickets).where(eq(tickets.id, ticketId));
    const [txRow] = await this.db
      .insert(blockchainTransactions)
      .values({ type: 'MINT', ticketId, eventId: t?.eventId, chainId, status: 'CONFIRMED', errorMessage: 'Recovered from contract state; original transaction hash not recorded' })
      .returning({ id: blockchainTransactions.id });
    await this.markMinted(ticketId, txRow.id, tokenId, null);
    this.log.warn(`Ticket ${ticketId} was already minted as token ${tokenId}; recorded from contract state`);
  }

  private async failTx(id: string, message: string) {
    await this.db
      .update(blockchainTransactions)
      .set({ status: 'FAILED', errorMessage: message.slice(0, 500), attemptCount: sql`${blockchainTransactions.attemptCount} + 1` })
      .where(eq(blockchainTransactions.id, id));
  }
}
