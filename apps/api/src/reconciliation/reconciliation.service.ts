import { Inject, Injectable } from '@nestjs/common';
import { blockchainTransactions, events, ledgerEntries, orderItems, orders, paymentWebhookEvents, payments, ticketRedemptions, tickets } from '@ticketpay/database';
import type { ReconStatus } from '@ticketpay/shared';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { ChainClient } from '../chain/chain.client';
import { DB, type Database } from '../db/db.module';

/** Written out: Drizzle leaves columns unqualified in single-table selects, and "id" would bind to bt.id. */
const TICKET_ID = sql.raw('"tickets"."id"');

/** Midtrans statuses that mean the money was collected. The mock provider reports the same words. */
const PROVIDER_SUCCESS = new Set(['settlement', 'capture']);
/** How long a paid ticket may wait for its mint before it needs a person to look. */
const MINT_GRACE_MS = 15 * 60_000;

export interface ReconRow {
  paymentId: string;
  reference: string;
  orderNumber: string;
  eventTitle: string;
  amount: number;
  provider: string;
  providerStatus: string | null;
  paymentStatus: string;
  orderStatus: string;
  /** Net of each type: a refund's reversal lines bring the fee and organizer net back to zero. */
  ledger: { gross: number | null; serviceFee: number | null; merchantNet: number | null; refund: number | null };
  tickets: { expected: number; issued: number; minted: number; failed: number; pending: number; cancelledOnChain: number; cancelFailed: number; refundedMinted: number };
  duplicateNotifications: number;
  status: ReconStatus;
  /** Why the row is not MATCHED, or notes on a matched row. Plain language for the dashboard. */
  findings: string[];
  createdAt: Date;
}

/**
 * Compares, per payment, the three records of the brief's section 6.6: the provider's status, the
 * internal payment and ledger, and ticket issuance on-chain. Computed on read from the live tables;
 * nothing here invents settlement data.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chain: ChainClient,
  ) {}

  async report(scope: { merchantId?: string; limit?: number } = {}, now = new Date()) {
    const where: SQL[] = [];
    if (scope.merchantId) where.push(eq(payments.merchantId, scope.merchantId));
    const base = await this.db
      .select({
        paymentId: payments.id,
        reference: payments.reference,
        amount: payments.amount,
        provider: payments.provider,
        providerStatus: payments.providerStatus,
        paymentStatus: payments.status,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        orderStatus: orders.status,
        orderTotal: orders.total,
        eventTitle: events.title,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(events, eq(orders.eventId, events.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(scope.limit ?? 300);
    if (!base.length) return { rows: [] as ReconRow[], summary: this.summarize([]), chainEnabled: this.chain.config.enabled };

    const paymentIds = base.map((b) => b.paymentId);
    const orderIds = base.map((b) => b.orderId);
    const [ledger, quantities, ticketStats, duplicates, redeemFailures] = await Promise.all([
      this.db
        .select({
          paymentId: ledgerEntries.paymentId,
          type: ledgerEntries.type,
          // Signed in the type's natural direction: fee taken is a DEBIT, gross and organizer net are CREDITs.
          amount: sql<number>`sum(case when (${ledgerEntries.type} = 'SERVICE_FEE' or ${ledgerEntries.type} = 'REFUND') = (${ledgerEntries.direction} = 'DEBIT') then ${ledgerEntries.amount} else -${ledgerEntries.amount} end)`.mapWith(Number),
        })
        .from(ledgerEntries)
        .where(and(inArray(ledgerEntries.paymentId, paymentIds), inArray(ledgerEntries.type, ['GROSS_SALE', 'SERVICE_FEE', 'MERCHANT_NET', 'REFUND'])))
        .groupBy(ledgerEntries.paymentId, ledgerEntries.type),
      this.db
        .select({ orderId: orderItems.orderId, qty: sql<number>`sum(${orderItems.quantity})`.mapWith(Number) })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .groupBy(orderItems.orderId),
      this.db
        .select({
          paymentId: tickets.paymentId,
          issued: sql<number>`count(*) filter (where ${tickets.status} <> 'CANCELLED')`.mapWith(Number),
          minted: sql<number>`count(*) filter (where ${tickets.mintStatus} = 'MINTED')`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${tickets.mintStatus} = 'FAILED')`.mapWith(Number),
          pending: sql<number>`count(*) filter (where ${tickets.mintStatus} in ('PENDING', 'SUBMITTED') and ${tickets.status} <> 'CANCELLED')`.mapWith(Number),
          refundedMinted: sql<number>`count(*) filter (where ${tickets.status} = 'CANCELLED' and ${tickets.mintStatus} = 'MINTED')`.mapWith(Number),
          cancelledOnChain: sql<number>`count(*) filter (where exists (select 1 from ${blockchainTransactions} bt where bt.ticket_id = ${TICKET_ID} and bt.type = 'CANCEL' and bt.status = 'CONFIRMED'))`.mapWith(Number),
          cancelFailed: sql<number>`count(*) filter (where ${tickets.status} = 'CANCELLED' and exists (select 1 from ${blockchainTransactions} bt where bt.ticket_id = ${TICKET_ID} and bt.type = 'CANCEL' and bt.status = 'FAILED') and not exists (select 1 from ${blockchainTransactions} bt where bt.ticket_id = ${TICKET_ID} and bt.type = 'CANCEL' and bt.status = 'CONFIRMED'))`.mapWith(Number),
        })
        .from(tickets)
        .where(inArray(tickets.paymentId, paymentIds))
        .groupBy(tickets.paymentId),
      this.db
        .select({ paymentId: paymentWebhookEvents.paymentId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(paymentWebhookEvents)
        .where(and(inArray(paymentWebhookEvents.paymentId, paymentIds), eq(paymentWebhookEvents.outcome, 'DUPLICATE')))
        .groupBy(paymentWebhookEvents.paymentId),
      this.db
        .select({ paymentId: tickets.paymentId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(ticketRedemptions)
        .innerJoin(tickets, eq(ticketRedemptions.ticketId, tickets.id))
        .where(and(inArray(tickets.paymentId, paymentIds), eq(ticketRedemptions.chainStatus, 'FAILED')))
        .groupBy(tickets.paymentId),
    ]);

    const ledgerBy = new Map<string, Record<string, number>>();
    for (const l of ledger) ledgerBy.set(l.paymentId, { ...(ledgerBy.get(l.paymentId) ?? {}), [l.type]: l.amount });
    const qtyBy = new Map(quantities.map((q) => [q.orderId, q.qty]));
    const ticketsBy = new Map(ticketStats.map((t) => [t.paymentId, t]));
    const dupBy = new Map(duplicates.map((d) => [d.paymentId!, d.n]));
    const redeemFailBy = new Map(redeemFailures.map((r) => [r.paymentId, r.n]));

    const rows = base.map((b): ReconRow => {
      const l = ledgerBy.get(b.paymentId) ?? {};
      const t = ticketsBy.get(b.paymentId) ?? { issued: 0, minted: 0, failed: 0, pending: 0, refundedMinted: 0, cancelledOnChain: 0, cancelFailed: 0 };
      const row: ReconRow = {
        paymentId: b.paymentId,
        reference: b.reference,
        orderNumber: b.orderNumber,
        eventTitle: b.eventTitle,
        amount: b.amount,
        provider: b.provider,
        providerStatus: b.providerStatus,
        paymentStatus: b.paymentStatus,
        orderStatus: b.orderStatus,
        ledger: { gross: l.GROSS_SALE ?? null, serviceFee: l.SERVICE_FEE ?? null, merchantNet: l.MERCHANT_NET ?? null, refund: l.REFUND ?? null },
        tickets: {
          expected: qtyBy.get(b.orderId) ?? 0,
          issued: t.issued,
          minted: t.minted,
          failed: t.failed,
          pending: t.pending,
          cancelledOnChain: t.cancelledOnChain,
          cancelFailed: t.cancelFailed,
          refundedMinted: t.refundedMinted,
        },
        duplicateNotifications: dupBy.get(b.paymentId) ?? 0,
        status: 'MATCHED',
        findings: [],
        createdAt: b.createdAt,
      };
      this.classify(row, b.paidAt, b.orderTotal, redeemFailBy.get(b.paymentId) ?? 0, now);
      return row;
    });
    return { rows, summary: this.summarize(rows), chainEnabled: this.chain.config.enabled };
  }

  /** Worst finding wins: INVESTIGATE > MISMATCH > PENDING > MATCHED. */
  private classify(row: ReconRow, paidAt: Date | null, orderTotal: number, redeemFailures: number, now: Date) {
    const rank: Record<ReconStatus, number> = { MATCHED: 0, PENDING: 1, MISMATCH: 2, INVESTIGATE: 3 };
    const flag = (status: ReconStatus, finding: string) => {
      row.findings.push(finding);
      if (rank[status] > rank[row.status]) row.status = status;
    };
    const providerPaid = row.providerStatus != null && PROVIDER_SUCCESS.has(row.providerStatus);
    const paid = row.paymentStatus === 'PAID';
    const refunded = row.paymentStatus === 'REFUNDED' || row.paymentStatus === 'REFUND_PENDING';
    const { gross, serviceFee, merchantNet } = row.ledger;
    const hasLedger = gross != null || serviceFee != null || merchantNet != null;

    if (row.paymentStatus === 'PENDING') flag('PENDING', 'Waiting for the buyer to pay');
    if (providerPaid && !paid && !refunded) flag('MISMATCH', `The provider reports "${row.providerStatus}" but the internal status is ${row.paymentStatus}`);
    if (paid && row.providerStatus && !providerPaid) flag('MISMATCH', `Paid internally but the provider's last status is "${row.providerStatus}"`);
    if (paid && row.orderStatus !== 'PAID') flag('MISMATCH', `The payment is PAID but the order is ${row.orderStatus}`);

    if (paid) {
      if (!hasLedger) flag('MISMATCH', 'Paid, but no ledger entries were written');
      else {
        if (gross !== row.amount || row.amount !== orderTotal) flag('MISMATCH', 'The gross ledger amount does not equal the amount paid');
        if ((serviceFee ?? 0) + (merchantNet ?? 0) !== (gross ?? 0)) flag('MISMATCH', 'Service fee plus organizer net does not add up to the gross amount');
      }
      if (row.tickets.issued !== row.tickets.expected) flag('MISMATCH', `${row.tickets.issued} of ${row.tickets.expected} tickets were issued`);
    } else if (hasLedger && !refunded) {
      flag('MISMATCH', `Ledger entries exist but the payment is ${row.paymentStatus}`);
    }
    if (!paid && !refunded && row.tickets.issued > 0) flag('MISMATCH', `Tickets were issued but the payment is ${row.paymentStatus}`);
    const activeMinted = row.tickets.minted - row.tickets.refundedMinted;
    if (!paid && activeMinted > 0 && !(refunded && row.tickets.issued === 0)) flag('INVESTIGATE', `${activeMinted} tickets are minted and still active but the payment is ${row.paymentStatus}`);

    if (row.paymentStatus === 'REFUNDED') {
      if (row.ledger.refund !== row.amount) flag('MISMATCH', 'Refunded, but the refund ledger line does not equal the amount paid');
      if ((row.ledger.serviceFee ?? 0) !== 0 || (row.ledger.merchantNet ?? 0) !== 0) flag('MISMATCH', 'Refunded, but the service fee and organizer net were not fully reversed');
      if (this.chain.config.enabled && row.tickets.refundedMinted > row.tickets.cancelledOnChain) {
        const waiting = row.tickets.refundedMinted - row.tickets.cancelledOnChain;
        if (row.tickets.cancelFailed > 0) flag('INVESTIGATE', `${row.tickets.cancelFailed} refunded tickets could not be cancelled on-chain; see Blockchain monitoring`);
        else flag('PENDING', `${waiting} refunded tickets are being cancelled on-chain`);
      }
    }

    if (paid && this.chain.config.enabled && row.tickets.issued > 0) {
      if (row.tickets.failed > 0) flag('INVESTIGATE', `${row.tickets.failed} mints failed; they are retried automatically`);
      if (row.tickets.pending > 0) {
        const waited = paidAt ? now.getTime() - paidAt.getTime() : 0;
        if (waited > MINT_GRACE_MS) flag('INVESTIGATE', `${row.tickets.pending} tickets still not minted ${Math.round(waited / 60_000)} minutes after payment`);
        else flag('PENDING', `${row.tickets.pending} tickets are being minted`);
      }
    }
    if (redeemFailures > 0) flag('INVESTIGATE', `${redeemFailures} on-chain redeems failed after admission`);
    // Duplicates are expected (providers retry) and were ignored safely; noted, not a mismatch.
    if (row.duplicateNotifications > 0) row.findings.push(`${row.duplicateNotifications} duplicate notifications received and ignored`);
  }

  private summarize(rows: ReconRow[]) {
    const summary: Record<ReconStatus, number> = { MATCHED: 0, PENDING: 0, MISMATCH: 0, INVESTIGATE: 0 };
    for (const r of rows) summary[r.status]++;
    return summary;
  }
}
