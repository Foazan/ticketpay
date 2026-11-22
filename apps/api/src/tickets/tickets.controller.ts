import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { blockchainTransactions, events, ticketRedemptions, ticketTiers, tickets } from '@ticketpay/database';
import type { SessionUser, TicketQr } from '@ticketpay/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { ChainClient } from '../chain/chain.client';
import { CurrentUser, Roles } from '../common/decorators';
import { DB, type Database } from '../db/db.module';
import { GateService } from '../gate/gate.service';

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
  redeemedAt: ticketRedemptions.redeemedAt,
  redeemChainStatus: ticketRedemptions.chainStatus,
};

type Row = { id: string; tokenId: string | null; mintStatus: string; redeemedAt: Date | null; redeemChainStatus: string | null };
type Hashes = Map<string, { mint?: string; redeem?: string }>;

/** A buyer's own tickets. Every query filters by the session user id. */
@Roles('BUYER')
@Controller('v1/tickets')
export class TicketsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
    private readonly gate: GateService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const rows = await this.db
      .select(columns)
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .leftJoin(ticketRedemptions, eq(ticketRedemptions.ticketId, tickets.id))
      .where(eq(tickets.ownerId, user.id))
      .orderBy(desc(events.startAt));
    const hashes = await this.txHashes(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, chain: this.chainRecord(r, hashes.get(r.id)) }));
  }

  /**
   * A fresh single-use entry QR for the caller's own active ticket. The payload is an opaque random
   * token; only its hash is stored. The page calls this again every refreshInSeconds.
   */
  @Get(':id/qr')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  qr(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<TicketQr> {
    return this.gate.issueQr(user, id);
  }

  @Get(':id')
  async detail(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const [row] = await this.db
      .select({ ...columns, paymentRefHash: tickets.paymentRefHash, validationCode: tickets.validationCode })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .leftJoin(ticketRedemptions, eq(ticketRedemptions.ticketId, tickets.id))
      .where(and(eq(tickets.id, id), eq(tickets.ownerId, user.id)));
    // Someone else's ticket is reported as missing, so ticket ids cannot be probed.
    if (!row) throw new NotFoundException('Ticket not found');
    const hashes = await this.txHashes([row.id]);
    const owner = this.chain.config.enabled && this.chain.configProblem() === null ? this.chain.custodialAddress(user.id) : null;
    // The manual code is a fallback for the gate; it is only shown while the ticket can still be used.
    const validationCode = row.status === 'ACTIVE' ? row.validationCode : null;
    return { ...row, validationCode, holderName: user.fullName, chain: { ...this.chainRecord(row, hashes.get(row.id)), ownerAddress: owner } };
  }

  /** Hashes of the confirmed mint and redeem transactions for each ticket, when recorded. */
  private async txHashes(ids: string[]): Promise<Hashes> {
    const map: Hashes = new Map();
    if (!ids.length) return map;
    const txs = await this.db
      .select({ ticketId: blockchainTransactions.ticketId, type: blockchainTransactions.type, txHash: blockchainTransactions.txHash })
      .from(blockchainTransactions)
      .where(
        and(
          inArray(blockchainTransactions.ticketId, ids),
          inArray(blockchainTransactions.type, ['MINT', 'REDEEM']),
          eq(blockchainTransactions.status, 'CONFIRMED'),
          isNotNull(blockchainTransactions.txHash),
        ),
      );
    for (const t of txs) {
      const entry = map.get(t.ticketId!) ?? {};
      if (t.type === 'MINT') entry.mint = t.txHash!;
      else entry.redeem = t.txHash!;
      map.set(t.ticketId!, entry);
    }
    return map;
  }

  /** What the buyer's UI needs to show and link the on-chain record. Never includes keys or secrets. */
  private chainRecord(row: Row, hashes: { mint?: string; redeem?: string } | undefined) {
    const c = this.chain.config;
    const address = c.contractAddress;
    const txHash = hashes?.mint ?? null;
    const redeemTxHash = hashes?.redeem ?? null;
    return {
      enabled: c.enabled,
      network: c.label,
      chainId: c.chainId,
      contractAddress: address,
      txHash,
      txUrl: txHash ? c.explorerTxUrl(txHash) : null,
      tokenUrl: address && row.tokenId ? c.explorerTokenUrl(address, row.tokenId) : null,
      contractUrl: address ? c.explorerAddressUrl(address) : null,
      // Gate admission is recorded off-chain first; this says whether the chain has caught up.
      redeemStatus: row.redeemedAt ? (c.enabled ? row.redeemChainStatus : 'OFF_CHAIN') : null,
      redeemTxHash,
      redeemTxUrl: redeemTxHash ? c.explorerTxUrl(redeemTxHash) : null,
    };
  }
}
