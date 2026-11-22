import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { blockchainTransactions, events, ticketTiers, tickets } from '@ticketpay/database';
import type { SessionUser } from '@ticketpay/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { ChainClient } from '../chain/chain.client';
import { CurrentUser, Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';

const columns = {
  id: tickets.id,
  status: tickets.status,
  mintStatus: tickets.mintStatus,
  tokenId: tickets.tokenId,
  seq: tickets.seq,
  createdAt: tickets.createdAt,
  eventTitle: events.title,
  eventSlug: events.slug,
  eventStartAt: events.startAt,
  eventEndAt: events.endAt,
  venue: events.venue,
  city: events.city,
  posterPath: events.posterPath,
  onChainEventId: events.onChainEventId,
  tierName: ticketTiers.name,
  tierCode: ticketTiers.tierCode,
};

type Row = { id: string; tokenId: string | null; mintStatus: string };

/** A buyer's own tickets. Every query filters by the session user id. */
@Roles('BUYER')
@Controller('v1/tickets')
export class TicketsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const rows = await this.db
      .select(columns)
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .where(eq(tickets.ownerId, user.id))
      .orderBy(desc(events.startAt));
    const hashes = await this.mintHashes(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, chain: this.chainRecord(r, hashes.get(r.id) ?? null) }));
  }

  @Get(':id')
  async detail(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const [row] = await this.db
      .select({ ...columns, paymentRefHash: tickets.paymentRefHash })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .where(and(eq(tickets.id, id), eq(tickets.ownerId, user.id)));
    // Someone else's ticket is reported as missing, so ticket ids cannot be probed.
    if (!row) throw new NotFoundException('Ticket not found');
    const hashes = await this.mintHashes([row.id]);
    const owner = this.chain.config.enabled && this.chain.configProblem() === null ? this.chain.custodialAddress(user.id) : null;
    return { ...row, holderName: user.fullName, chain: { ...this.chainRecord(row, hashes.get(row.id) ?? null), ownerAddress: owner } };
  }

  /** Hash of the confirmed mint transaction for each ticket, when one was recorded. */
  private async mintHashes(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const txs = await this.db
      .select({ ticketId: blockchainTransactions.ticketId, txHash: blockchainTransactions.txHash, blockNumber: blockchainTransactions.blockNumber })
      .from(blockchainTransactions)
      .where(
        and(
          inArray(blockchainTransactions.ticketId, ids),
          eq(blockchainTransactions.type, 'MINT'),
          eq(blockchainTransactions.status, 'CONFIRMED'),
          isNotNull(blockchainTransactions.txHash),
        ),
      );
    return new Map(txs.map((t) => [t.ticketId!, t.txHash!]));
  }

  /** What the buyer's UI needs to show and link the on-chain record. Never includes keys or secrets. */
  private chainRecord(row: Row, txHash: string | null) {
    const c = this.chain.config;
    const address = c.contractAddress;
    return {
      enabled: c.enabled,
      network: c.label,
      chainId: c.chainId,
      contractAddress: address,
      txHash,
      txUrl: txHash ? c.explorerTxUrl(txHash) : null,
      tokenUrl: address && row.tokenId ? c.explorerTokenUrl(address, row.tokenId) : null,
      contractUrl: address ? c.explorerAddressUrl(address) : null,
    };
  }
}
