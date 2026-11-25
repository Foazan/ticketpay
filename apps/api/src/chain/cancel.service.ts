import { Inject, Injectable, Logger } from '@nestjs/common';
import { blockchainTransactions, tickets } from '@ticketpay/database';
import { and, desc, eq, notExists, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { ChainClient } from './chain.client';
import { RetryLaterError } from './mint.service';

const ON_CHAIN = { None: 0, Valid: 1, Redeemed: 2, Cancelled: 3 } as const;

/** Raised when retrying cannot help: a person has to act (grant a role, reconcile a record). */
export class NeedsOperatorError extends Error {}

export type CancelResult = 'cancelled' | 'recovered' | 'already-confirmed' | 'not-minted' | 'not-cancelled-in-db' | 'missing';

/**
 * Cancels a refunded ticket's NFT with cancel(tokenId), so the token shows Cancelled to anyone
 * checking it on-chain. cancel() needs the contract's admin role; without it the transaction is
 * recorded as failed with instructions, never reported as done.
 */
@Injectable()
export class CancelService {
  private readonly log = new Logger('Cancel');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
  ) {}

  async processCancel(ticketId: string): Promise<CancelResult> {
    const [t] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!t) return 'missing';
    if (t.status !== 'CANCELLED') return 'not-cancelled-in-db';
    if (t.mintStatus === 'SUBMITTED' || t.mintStatus === 'PENDING') throw new RetryLaterError('Waiting for the mint to settle before cancelling');
    if (t.mintStatus !== 'MINTED' || !t.tokenId) return 'not-minted';
    const tokenId = BigInt(t.tokenId);
    const chainId = this.chain.config.chainId!;
    const [done] = await this.db
      .select({ id: blockchainTransactions.id })
      .from(blockchainTransactions)
      .where(and(eq(blockchainTransactions.ticketId, ticketId), eq(blockchainTransactions.type, 'CANCEL'), eq(blockchainTransactions.status, 'CONFIRMED')))
      .limit(1);
    if (done) return 'already-confirmed';

    const [previous] = await this.db
      .select()
      .from(blockchainTransactions)
      .where(and(eq(blockchainTransactions.ticketId, ticketId), eq(blockchainTransactions.type, 'CANCEL'), eq(blockchainTransactions.status, 'SUBMITTED')))
      .orderBy(desc(blockchainTransactions.createdAt))
      .limit(1);
    if (previous?.txHash) {
      const found = await this.chain.lookup(previous.txHash);
      if (found === 'pending') throw new RetryLaterError(`Cancel transaction ${previous.txHash} is still pending`);
      if (found !== 'missing' && found.status === 1) {
        await this.confirm(previous.id, found.blockNumber);
        return 'recovered';
      }
      await this.failTx(previous.id, found === 'missing' ? 'Transaction dropped from the mempool' : 'Transaction reverted');
    }

    const status = await this.chain.ticketStatus(tokenId);
    if (status === ON_CHAIN.Cancelled) {
      await this.record(ticketId, t.eventId, chainId, 'CONFIRMED', null, 'Already cancelled on-chain; recorded from contract state');
      return 'recovered';
    }
    if (status === ON_CHAIN.Redeemed) {
      await this.record(ticketId, t.eventId, chainId, 'FAILED', null, 'The token was redeemed on-chain, so it cannot be cancelled; reconcile manually');
      throw new NeedsOperatorError('Token already redeemed on-chain');
    }
    if (!(await this.chain.signerIsAdmin())) {
      const hint = `The backend signer lacks the contract admin role that cancel() needs. Run "pnpm chain:grant-admin:${this.chain.config.mode === 'sepolia' ? 'sepolia' : 'local'}" with the deployer key, then retry from Blockchain monitoring.`;
      await this.record(ticketId, t.eventId, chainId, 'FAILED', null, hint);
      throw new NeedsOperatorError(hint);
    }

    const [txRow] = await this.db.insert(blockchainTransactions).values({ type: 'CANCEL', ticketId, eventId: t.eventId, chainId, status: 'QUEUED' }).returning();
    let sent;
    try {
      sent = await this.chain.sendCancel(tokenId);
    } catch (err) {
      await this.failTx(txRow.id, this.chain.errorText(err));
      throw err;
    }
    await this.db.update(blockchainTransactions).set({ status: 'SUBMITTED', txHash: sent.hash }).where(eq(blockchainTransactions.id, txRow.id));
    const receipt = await this.chain.waitFor(sent);
    if (!receipt) throw new RetryLaterError(`Cancel transaction ${sent.hash} not confirmed yet`);
    if (receipt.status !== 1) {
      await this.failTx(txRow.id, 'Transaction reverted');
      throw new Error(`Cancel transaction ${sent.hash} reverted`);
    }
    await this.confirm(txRow.id, receipt.blockNumber);
    this.log.log(`Cancelled token ${tokenId} on-chain for refunded ticket ${ticketId} (tx ${sent.hash})`);
    return 'cancelled';
  }

  /** Refunded, minted tickets whose token is not cancelled yet and that nobody tried in the last 10 minutes. */
  async cancelsToSweep(now = new Date()): Promise<string[]> {
    const recent = new Date(now.getTime() - 10 * 60_000);
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.status, 'CANCELLED'),
          eq(tickets.mintStatus, 'MINTED'),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(blockchainTransactions)
              .where(
                and(
                  // Written out: unqualified, "id" would bind to the subquery's own table.
                  sql`${blockchainTransactions.ticketId} = "tickets"."id"`,
                  eq(blockchainTransactions.type, 'CANCEL'),
                  sql`(${blockchainTransactions.status} = 'CONFIRMED' or ${blockchainTransactions.createdAt} > ${recent})`,
                ),
              ),
          ),
        ),
      )
      .limit(200);
    return rows.map((r) => r.id);
  }

  private async record(ticketId: string, eventId: string, chainId: number, status: 'CONFIRMED' | 'FAILED', txHash: string | null, message: string) {
    await this.db.insert(blockchainTransactions).values({ type: 'CANCEL', ticketId, eventId, chainId, status, txHash, errorMessage: message.slice(0, 500) });
  }

  private async confirm(id: string, blockNumber: number | null) {
    await this.db.update(blockchainTransactions).set({ status: 'CONFIRMED', blockNumber, errorMessage: null }).where(eq(blockchainTransactions.id, id));
  }

  private async failTx(id: string, message: string) {
    await this.db
      .update(blockchainTransactions)
      .set({ status: 'FAILED', errorMessage: message.slice(0, 500), attemptCount: sql`${blockchainTransactions.attemptCount} + 1` })
      .where(eq(blockchainTransactions.id, id));
  }
}
