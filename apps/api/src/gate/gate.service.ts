import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  events,
  gateEventPermissions,
  orders,
  payments,
  sha256Hex,
  ticketQrTokens,
  ticketRedemptions,
  ticketTiers,
  tickets,
  users,
} from '@ticketpay/database';
import {
  QR_PREFIX,
  QR_REFRESH_SECONDS,
  QR_TTL_SECONDS,
  normalizeValidationCode,
  type GateCheckInput,
  type GateOutcome,
  type GateResult,
  type SessionUser,
  type TicketQr,
} from '@ticketpay/shared';
import { aliasedTable, and, eq, isNull, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ChainClient } from '../chain/chain.client';
import { DB, type Database } from '../db/db.module';
import { Queues } from '../queue/queue.module';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Conn = Database | Tx;

/** Everything the checks need about one ticket, loaded in a single query. */
interface TicketContext {
  id: string;
  eventId: string;
  ownerId: string;
  status: 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  seq: number;
  tokenId: string | null;
  mintStatus: string;
  eventTitle: string;
  tierName: string;
  holderName: string;
  paymentStatus: string;
  orderStatus: string;
  redeemedAt: Date | null;
  redeemedBy: string | null;
  requiresIdCheck: boolean;
}

/** How the scanned or typed value was resolved before the ticket checks. */
type Lookup =
  | { kind: 'none'; outcome: GateOutcome; message: string }
  | { kind: 'qr'; ticketId: string; token: { id: string; ownerId: string; expiresAt: Date; usedAt: Date | null } }
  | { kind: 'code'; ticketId: string };

const MESSAGES: Record<GateOutcome, string> = {
  VALID: 'Valid ticket. Confirm admission.',
  ADMITTED: 'Admitted.',
  ALREADY_REDEEMED: 'This ticket has already been used.',
  INVALID: 'Not a valid TicketPay ticket.',
  EXPIRED: 'This QR code has expired. Ask the holder to refresh their ticket page.',
  WRONG_EVENT: 'This ticket is for a different event.',
  NOT_PAID: 'The payment for this ticket is not settled.',
  CANCELLED: 'This ticket has been cancelled or refunded.',
  OWNERSHIP_MISMATCH: 'This QR code was not issued to the current ticket holder.',
  ID_CHECK_REQUIRED: 'This event requires an ID check. Compare a photo ID with the holder name, then confirm before admitting.',
};

const result = (outcome: GateOutcome, extra: Partial<GateResult> = {}): GateResult => ({
  outcome,
  ok: outcome === 'VALID' || outcome === 'ADMITTED',
  message: MESSAGES[outcome],
  ...extra,
});

/**
 * Gate validation and single-use redemption (Part 9 of the brief).
 *
 * The database is the source of truth for admission, so a gate keeps working when the chain is slow.
 * The on-chain redeem follows asynchronously and its state is shown honestly as pending until confirmed.
 */
@Injectable()
export class GateService {
  private readonly log = new Logger('Gate');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
    private readonly queues: Queues,
    private readonly audit: AuditService,
  ) {}

  // ---------- QR issuance (buyer side) ----------

  /**
   * Issues a fresh single-use QR token for the buyer's own ticket. Only its SHA-256 is stored.
   * The ticket page asks for a new one every QR_REFRESH_SECONDS; each lives QR_TTL_SECONDS.
   */
  async issueQr(user: SessionUser, ticketId: string): Promise<TicketQr> {
    const [ticket] = await this.db
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.ownerId, user.id)));
    // Someone else's ticket is reported as missing (T18 on the buyer side).
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== 'ACTIVE') throw new ForbiddenException(`This ticket is ${ticket.status.toLowerCase()} and has no entry QR`);
    const raw = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);
    await this.db.insert(ticketQrTokens).values({ ticketId, ownerId: user.id, tokenHash: sha256Hex(raw), expiresAt });
    return { qr: `${QR_PREFIX}${raw}`, expiresAt: expiresAt.toISOString(), refreshInSeconds: QR_REFRESH_SECONDS };
  }

  /** Expired, unused QR tokens are useless; keep the table small. Called by the maintenance sweep. */
  async purgeExpiredQr(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 24 * 3600 * 1000);
    const removed = await this.db
      .delete(ticketQrTokens)
      .where(and(lt(ticketQrTokens.expiresAt, cutoff), isNull(ticketQrTokens.usedAt)))
      .returning({ id: ticketQrTokens.id });
    return removed.length;
  }

  // ---------- Gate side ----------

  /** Checks a scanned QR or typed code without admitting anyone. */
  async validate(staff: SessionUser, input: GateCheckInput): Promise<GateResult> {
    await this.assertPermitted(staff, input.eventId);
    const lookup = await this.lookup(this.db, input);
    if (lookup.kind === 'none') return result(lookup.outcome);
    const ctx = await this.loadContext(this.db, lookup.ticketId, false);
    if (!ctx) return result('INVALID');
    const checked = this.evaluate(ctx, input.eventId, lookup);
    if (checked.outcome !== 'VALID') return checked;
    const chainOwner = await this.chainOwnerCheck(ctx);
    // The NFT sits somewhere other than the holder's address: the records disagree, so do not admit.
    if (chainOwner === 'MISMATCH') return result('OWNERSHIP_MISMATCH', { method: checked.method, chainOwner });
    return { ...checked, chainOwner, requiresIdCheck: ctx.requiresIdCheck };
  }

  /**
   * Admits the holder. Runs every check again inside one transaction with the ticket row locked,
   * then flips ACTIVE to REDEEMED with a conditional update. Two gates scanning the same ticket at
   * the same moment are serialised by the lock; the second sees REDEEMED (T19). The unique
   * ticket_redemptions.ticket_id is a final guard.
   */
  async redeem(staff: SessionUser, input: GateCheckInput, ip?: string): Promise<GateResult> {
    await this.assertPermitted(staff, input.eventId);
    let admitted: { ticketId: string; redemptionId: string } | null = null;
    const outcome = await this.db.transaction(async (tx) => {
      const lookup = await this.lookup(tx, input);
      if (lookup.kind === 'none') return result(lookup.outcome);
      const ctx = await this.loadContext(tx, lookup.ticketId, true);
      if (!ctx) return result('INVALID');
      const checked = this.evaluate(ctx, input.eventId, lookup);
      if (checked.outcome !== 'VALID') return checked;
      // Enforced here, not only on the screen: nothing is consumed until staff confirm the ID check.
      if (ctx.requiresIdCheck && input.idChecked !== true) {
        return result('ID_CHECK_REQUIRED', { method: checked.method, ticket: checked.ticket, requiresIdCheck: true });
      }

      const method = lookup.kind === 'qr' ? 'QR' : 'MANUAL_CODE';
      if (lookup.kind === 'qr') {
        const used = await tx
          .update(ticketQrTokens)
          .set({ usedAt: new Date() })
          .where(and(eq(ticketQrTokens.id, lookup.token.id), isNull(ticketQrTokens.usedAt)))
          .returning({ id: ticketQrTokens.id });
        if (!used.length) return result('ALREADY_REDEEMED', { ticket: checked.ticket });
      }
      const flipped = await tx
        .update(tickets)
        .set({ status: 'REDEEMED' })
        .where(and(eq(tickets.id, ctx.id), eq(tickets.status, 'ACTIVE')))
        .returning({ id: tickets.id });
      if (!flipped.length) return result('ALREADY_REDEEMED', { ticket: checked.ticket });
      const [redemption] = await tx
        .insert(ticketRedemptions)
        .values({
          ticketId: ctx.id,
          gateStaffId: staff.id,
          eventId: ctx.eventId,
          method,
          qrTokenId: lookup.kind === 'qr' ? lookup.token.id : null,
        })
        .returning({ id: ticketRedemptions.id, redeemedAt: ticketRedemptions.redeemedAt });
      admitted = { ticketId: ctx.id, redemptionId: redemption.id };
      return result('ADMITTED', {
        method,
        ticket: checked.ticket,
        redeemedAt: redemption.redeemedAt.toISOString(),
        redeemedBy: staff.fullName,
        requiresIdCheck: ctx.requiresIdCheck,
        idChecked: input.idChecked === true,
      });
    });

    if (admitted) {
      const { ticketId, redemptionId } = admitted;
      await this.audit.record({
        actorId: staff.id,
        actorRole: staff.role,
        action: 'ticket.redeemed',
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: { eventId: input.eventId, method: outcome.method, redemptionId, idCheckRequired: outcome.requiresIdCheck ?? false, idChecked: outcome.idChecked ?? false },
        ipAddress: ip,
      });
      // After commit: the on-chain redeem follows. A queue or chain outage never undoes the admission.
      await this.queues.enqueueRedeem(ticketId);
    }
    return outcome;
  }

  // ---------- Internals ----------

  /** Gate staff may only act for events an administrator assigned to them. */
  private async assertPermitted(staff: SessionUser, eventId: string) {
    const [row] = await this.db
      .select({ id: gateEventPermissions.id })
      .from(gateEventPermissions)
      .where(and(eq(gateEventPermissions.gateStaffId, staff.id), eq(gateEventPermissions.eventId, eventId)));
    if (!row) throw new ForbiddenException('You are not assigned to this event');
  }

  private async lookup(conn: Conn, input: GateCheckInput): Promise<Lookup> {
    let qr = input.qr;
    let code = input.code;
    // A scanner may read a printed manual code; accept it as one.
    if (qr && !qr.startsWith(QR_PREFIX) && normalizeValidationCode(qr)) {
      code = qr;
      qr = undefined;
    }
    if (qr) {
      if (!qr.startsWith(QR_PREFIX)) return { kind: 'none', outcome: 'INVALID', message: '' };
      const raw = qr.slice(QR_PREFIX.length);
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(raw)) return { kind: 'none', outcome: 'INVALID', message: '' };
      const [token] = await conn
        .select({ id: ticketQrTokens.id, ticketId: ticketQrTokens.ticketId, ownerId: ticketQrTokens.ownerId, expiresAt: ticketQrTokens.expiresAt, usedAt: ticketQrTokens.usedAt })
        .from(ticketQrTokens)
        .where(eq(ticketQrTokens.tokenHash, sha256Hex(raw)));
      if (!token) return { kind: 'none', outcome: 'INVALID', message: '' };
      return { kind: 'qr', ticketId: token.ticketId, token };
    }
    const normalized = code ? normalizeValidationCode(code) : null;
    if (!normalized) return { kind: 'none', outcome: 'INVALID', message: '' };
    const [ticket] = await conn.select({ id: tickets.id }).from(tickets).where(eq(tickets.validationCode, normalized));
    return ticket ? { kind: 'code', ticketId: ticket.id } : { kind: 'none', outcome: 'INVALID', message: '' };
  }

  private async loadContext(conn: Conn, ticketId: string, lock: boolean): Promise<TicketContext | null> {
    const holder = aliasedTable(users, 'holder');
    const gateStaff = aliasedTable(users, 'gate_staff');
    const query = conn
      .select({
        id: tickets.id,
        eventId: tickets.eventId,
        ownerId: tickets.ownerId,
        status: tickets.status,
        seq: tickets.seq,
        tokenId: tickets.tokenId,
        mintStatus: tickets.mintStatus,
        eventTitle: events.title,
        requiresIdCheck: events.requiresIdCheck,
        tierName: ticketTiers.name,
        holderName: holder.fullName,
        paymentStatus: payments.status,
        orderStatus: orders.status,
        redeemedAt: ticketRedemptions.redeemedAt,
        redeemedBy: gateStaff.fullName,
      })
      .from(tickets)
      .innerJoin(events, eq(tickets.eventId, events.id))
      .innerJoin(ticketTiers, eq(tickets.tierId, ticketTiers.id))
      .innerJoin(holder, eq(tickets.ownerId, holder.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .innerJoin(orders, eq(tickets.orderId, orders.id))
      .leftJoin(ticketRedemptions, eq(ticketRedemptions.ticketId, tickets.id))
      .leftJoin(gateStaff, eq(ticketRedemptions.gateStaffId, gateStaff.id))
      .where(eq(tickets.id, ticketId));
    // Lock only the ticket row: it is what two gates would race on.
    const [row] = lock ? await query.for('update', { of: tickets }) : await query;
    return (row as TicketContext | undefined) ?? null;
  }

  /** The checks from section 9.3, in the order that gives staff the most useful answer. */
  private evaluate(ctx: TicketContext, eventId: string, lookup: Exclude<Lookup, { kind: 'none' }>): GateResult {
    const ticket = { id: ctx.id, holderName: ctx.holderName, tierName: ctx.tierName, seq: ctx.seq, eventTitle: ctx.eventTitle, tokenId: ctx.tokenId };
    const method = lookup.kind === 'qr' ? 'QR' : 'MANUAL_CODE';
    // A ticket for another event reveals nothing about its holder.
    if (ctx.eventId !== eventId) return result('WRONG_EVENT', { method });
    if (ctx.orderStatus === 'REFUNDED' || ctx.status === 'CANCELLED' || ctx.status === 'EXPIRED') return result('CANCELLED', { method, ticket });
    if (ctx.paymentStatus !== 'PAID' || ctx.orderStatus !== 'PAID') return result('NOT_PAID', { method, ticket });
    if (ctx.status === 'REDEEMED') {
      return result('ALREADY_REDEEMED', { method, ticket, redeemedAt: ctx.redeemedAt?.toISOString(), redeemedBy: ctx.redeemedBy ?? undefined });
    }
    if (lookup.kind === 'qr') {
      // The QR must have been issued to whoever holds the ticket now (T18).
      if (lookup.token.ownerId !== ctx.ownerId) return result('OWNERSHIP_MISMATCH', { method });
      if (lookup.token.usedAt) return result('ALREADY_REDEEMED', { method, ticket });
      if (lookup.token.expiresAt.getTime() < Date.now()) return result('EXPIRED', { method });
    }
    return result('VALID', { method, ticket });
  }

  /**
   * Cross-checks the NFT owner against the holder's custodial address. Advisory and time-boxed:
   * a slow RPC must not hold up a queue at the gate, so any problem reports SKIPPED.
   */
  private async chainOwnerCheck(ctx: TicketContext): Promise<GateResult['chainOwner']> {
    if (!this.chain.config.enabled || this.chain.configProblem() || ctx.mintStatus !== 'MINTED' || !ctx.tokenId) return 'SKIPPED';
    try {
      const owner = await Promise.race([
        this.chain.ownerOf(BigInt(ctx.tokenId)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      return owner.toLowerCase() === this.chain.custodialAddress(ctx.ownerId).toLowerCase() ? 'MATCH' : 'MISMATCH';
    } catch (err) {
      this.log.warn(`On-chain owner check skipped for ticket ${ctx.id}: ${(err as Error).message}`);
      return 'SKIPPED';
    }
  }
}
