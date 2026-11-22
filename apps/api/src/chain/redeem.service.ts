import { Inject, Injectable, Logger } from '@nestjs/common';
import { blockchainTransactions, ticketRedemptions, tickets } from '@ticketpay/database';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { Queues } from '../queue/queue.module';
import { ChainClient } from './chain.client';
import { RetryLaterError } from './mint.service';

/** On-chain ticket status, as in TicketPayTicket.Status. */
const ON_CHAIN = { None: 0, Valid: 1, Redeemed: 2, Cancelled: 3 } as const;

export type RedeemResult = 'redeemed' | 'recovered' | 'already-confirmed' | 'cancelled-on-chain' | 'missing';

/**
 * Mirrors a gate admission on-chain by calling redeem(tokenId). The admission itself is already
 * committed in the database; until this succeeds the redemption shows as "on-chain pending",
 * never as confirmed. Safe to repeat: the contract rejects a second redeem, and the current
 * on-chain status is checked before sending anything.
 */
@Injectable()
export class RedeemService {
  private readonly log = new Logger('Redeem');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
    private readonly queues: Queues,
  ) {}

  async processRedeem(ticketId: string): Promise<RedeemResult> {
    const [row] = await this.db
      .select({
        tokenId: tickets.tokenId,
        mintStatus: tickets.mintStatus,
        eventId: tickets.eventId,
        redemptionId: ticketRedemptions.id,
        chainStatus: ticketRedemptions.chainStatus,
      })
      .from(ticketRedemptions)
      .innerJoin(tickets, eq(ticketRedemptions.ticketId, tickets.id))
      .where(eq(ticketRedemptions.ticketId, ticketId));
    if (!row) return 'missing';
    if (row.chainStatus === 'CONFIRMED') return 'already-confirmed';

    // A ticket can be admitted before its mint lands (for example bought at the door). Redeem after the mint.
    if (row.mintStatus !== 'MINTED' || !row.tokenId) {
      if (row.mintStatus === 'PENDING' || row.mintStatus === 'FAILED') await this.queues.enqueueMint(ticketId);
      throw new RetryLaterError(`Ticket ${ticketId} is not minted yet; redeem waits for the mint`);
    }
    const tokenId = BigInt(row.tokenId);
    const chainId = this.chain.config.chainId!;

    // 1. An earlier redeem transaction that was sent.
    const [previous] = await this.db
      .select()
      .from(blockchainTransactions)
      .where(and(eq(blockchainTransactions.ticketId, ticketId), eq(blockchainTransactions.type, 'REDEEM'), eq(blockchainTransactions.status, 'SUBMITTED')))
      .orderBy(desc(blockchainTransactions.createdAt))
      .limit(1);
    if (previous?.txHash) {
      const found = await this.chain.lookup(previous.txHash);
      if (found === 'pending') throw new RetryLaterError(`Redeem transaction ${previous.txHash} is still pending`);
      if (found !== 'missing' && found.status === 1) {
        await this.confirm(row.redemptionId, previous.id, found.blockNumber);
        return 'recovered';
      }
      await this.failTx(previous.id, found === 'missing' ? 'Transaction dropped from the mempool' : 'Transaction reverted');
    }

    // 2. What the contract says now.
    const status = await this.chain.ticketStatus(tokenId);
    if (status === ON_CHAIN.Redeemed) {
      await this.recordRecovered(ticketId, row.eventId, row.redemptionId, chainId);
      return 'recovered';
    }
    if (status === ON_CHAIN.Cancelled) {
      // Admitted at the gate but cancelled on-chain: the records disagree and need a person to look.
      await this.markFailed(ticketId, 'The token is cancelled on-chain; reconcile manually');
      return 'cancelled-on-chain';
    }
    if (status !== ON_CHAIN.Valid) throw new Error(`Token ${tokenId} has on-chain status ${status}`);

    // 3. Send the redeem.
    const [txRow] = await this.db.insert(blockchainTransactions).values({ type: 'REDEEM', ticketId, eventId: row.eventId, chainId, status: 'QUEUED' }).returning();
    let sent;
    try {
      sent = await this.chain.sendRedeem(tokenId);
    } catch (err) {
      await this.failTx(txRow.id, this.chain.errorText(err));
      if (this.chain.revertName(err) === 'TicketNotValid' && (await this.chain.ticketStatus(tokenId)) === ON_CHAIN.Redeemed) {
        await this.recordRecovered(ticketId, row.eventId, row.redemptionId, chainId);
        return 'recovered';
      }
      throw err;
    }
    await this.db.update(blockchainTransactions).set({ status: 'SUBMITTED', txHash: sent.hash }).where(eq(blockchainTransactions.id, txRow.id));
    const receipt = await this.chain.waitFor(sent);
    if (!receipt) throw new RetryLaterError(`Redeem transaction ${sent.hash} not confirmed yet`);
    if (receipt.status !== 1) {
      await this.failTx(txRow.id, 'Transaction reverted');
      throw new Error(`Redeem transaction ${sent.hash} reverted`);
    }
    await this.confirm(row.redemptionId, txRow.id, receipt.blockNumber);
    this.log.log(`Redeemed token ${tokenId} on-chain for ticket ${ticketId} (tx ${sent.hash})`);
    return 'redeemed';
  }

  /** After the last retry. Never presented as confirmed; the sweep tries again later. */
  async markFailed(ticketId: string, message: string) {
    await this.db
      .update(ticketRedemptions)
      .set({ chainStatus: 'FAILED', chainError: message.slice(0, 300), chainUpdatedAt: new Date() })
      .where(and(eq(ticketRedemptions.ticketId, ticketId), inArray(ticketRedemptions.chainStatus, ['PENDING', 'FAILED'])));
  }

  /** Admissions still waiting for their on-chain redeem, or failed a while ago. */
  async redemptionsToSweep(now = new Date()): Promise<string[]> {
    const rows = await this.db
      .select({ ticketId: ticketRedemptions.ticketId })
      .from(ticketRedemptions)
      .where(
        or(
          and(eq(ticketRedemptions.chainStatus, 'PENDING'), lt(ticketRedemptions.redeemedAt, new Date(now.getTime() - 60_000))),
          and(
            eq(ticketRedemptions.chainStatus, 'FAILED'),
            lt(ticketRedemptions.chainUpdatedAt, new Date(now.getTime() - 10 * 60_000)),
            // A token cancelled on-chain needs a person, not another retry.
            sql`coalesce(${ticketRedemptions.chainError}, '') not like 'The token is cancelled%'`,
          ),
        ),
      )
      .limit(200);
    return rows.map((r) => r.ticketId);
  }

  private async confirm(redemptionId: string, txRowId: string | null, blockNumber: number | null) {
    await this.db.transaction(async (tx) => {
      if (txRowId) await tx.update(blockchainTransactions).set({ status: 'CONFIRMED', blockNumber, errorMessage: null }).where(eq(blockchainTransactions.id, txRowId));
      await tx.update(ticketRedemptions).set({ chainStatus: 'CONFIRMED', chainError: null, chainUpdatedAt: new Date() }).where(eq(ticketRedemptions.id, redemptionId));
    });
  }

  private async recordRecovered(ticketId: string, eventId: string, redemptionId: string, chainId: number) {
    const [txRow] = await this.db
      .insert(blockchainTransactions)
      .values({ type: 'REDEEM', ticketId, eventId, chainId, status: 'CONFIRMED', errorMessage: 'Recovered from contract state; original transaction hash not recorded' })
      .returning({ id: blockchainTransactions.id });
    await this.confirm(redemptionId, txRow.id, null);
    this.log.warn(`Ticket ${ticketId} was already redeemed on-chain; recorded from contract state`);
  }

  private async failTx(id: string, message: string) {
    await this.db
      .update(blockchainTransactions)
      .set({ status: 'FAILED', errorMessage: message.slice(0, 500), attemptCount: sql`${blockchainTransactions.attemptCount} + 1` })
      .where(eq(blockchainTransactions.id, id));
  }
}
