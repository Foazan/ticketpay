// Midtrans adapter tests against a local fake of the Snap and Status APIs.
// This checks TicketPay's side of the integration (request shape, signature check, status mapping,
// status confirmation, retries). It does not prove the real Midtrans sandbox behaves the same way;
// run the sandbox walkthrough in docs/testing-guide.md for that.
import { auditLogs, events, ledgerEntries, orders, paymentWebhookEvents, payments, ticketTiers, tickets } from '@ticketpay/database';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PaymentsService } from '../src/payments/payments.service';
import { midtransSignature } from '../src/payments/providers/midtrans.provider';
import { bootTestApp, csrf, type TestContext } from './helpers';

const SERVER_KEY = 'SB-Mid-server-TESTKEY';
const SLUG = 'soundwave-festival-2026';

let ctx: TestContext;
let fake: Server;
let regularId: string;
const snapRequests: { auth: string; body: Record<string, any> }[] = [];
/** What the fake Status API returns per order_id. Missing means "404 not found". */
const statusByOrder = new Map<string, Record<string, string>>();
let statusApiDown = false;

beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/snap/v1/transactions') {
        const parsed = JSON.parse(body);
        snapRequests.push({ auth: req.headers.authorization ?? '', body: parsed });
        const id = parsed.transaction_details.order_id;
        statusByOrder.set(id, { transaction_status: 'pending', status_code: '201', gross_amount: `${parsed.transaction_details.gross_amount}.00`, payment_type: 'bank_transfer' });
        return res.writeHead(201).end(JSON.stringify({ token: `tok-${id}`, redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/tok-${id}` }));
      }
      const m = req.url?.match(/^\/v2\/(.+)\/status$/);
      if (req.method === 'GET' && m) {
        if (statusApiDown) return res.writeHead(503).end('{}');
        const s = statusByOrder.get(decodeURIComponent(m[1]));
        if (!s) return res.writeHead(200).end(JSON.stringify({ status_code: '404', status_message: "Transaction doesn't exist." }));
        return res.writeHead(200).end(JSON.stringify({ order_id: m[1], transaction_id: 'trx-1', ...s }));
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  ctx = await bootTestApp({
    PAYMENT_PROVIDER: 'midtrans',
    MIDTRANS_SERVER_KEY: SERVER_KEY,
    MIDTRANS_SNAP_URL: `${base}/snap/v1/transactions`,
    MIDTRANS_API_URL: base,
    MIDTRANS_ENABLED_METHODS: 'VA,QRIS',
    MIDTRANS_VERIFY_STATUS: 'true',
  });
  const [ev] = await ctx.db.select().from(events).where(eq(events.slug, SLUG));
  regularId = (await ctx.db.select().from(ticketTiers).where(and(eq(ticketTiers.eventId, ev.id), eq(ticketTiers.name, 'Regular'))))[0].id;
});

afterAll(async () => {
  await ctx.close();
  await new Promise((r) => fake.close(r));
});

/** Expires the buyer's leftover unpaid orders through the real sweeper (Midtrans answers "expire"). */
async function clearOpenOrders() {
  const open = await ctx.db
    .select({ orderId: orders.id, reference: payments.reference })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.buyerEmail, 'buyer@ticketpay.example'), eq(orders.status, 'PENDING')));
  for (const o of open) if (o.reference) setProviderStatus(o.reference, 'expire');
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, 'buyer@ticketpay.example'), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
}

async function createPayment(method = 'VA', quantity = 2) {
  await clearOpenOrders();
  const agent = await ctx.login('buyer@ticketpay.example');
  const order = await agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regularId, quantity }], checkoutKey: randomUUID(), buyerName: 'Rania Putri', buyerEmail: 'buyer@ticketpay.example' });
  expect(order.status).toBe(201);
  const pay = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method });
  return { agent, order: order.body, pay };
}

/** A notification signed the way Midtrans signs it. */
function notification(reference: string, transaction_status: string, opts: { status_code?: string; gross_amount?: string; fraud_status?: string; key?: string } = {}) {
  const status_code = opts.status_code ?? (transaction_status === 'settlement' ? '200' : '201');
  const gross_amount = opts.gross_amount ?? '309000.00';
  return {
    order_id: reference,
    status_code,
    gross_amount,
    transaction_status,
    payment_type: 'bank_transfer',
    transaction_id: 'trx-1',
    va_numbers: [{ bank: 'bca', va_number: '12345678901' }],
    ...(opts.fraud_status ? { fraud_status: opts.fraud_status } : {}),
    signature_key: midtransSignature(reference, status_code, gross_amount, opts.key ?? SERVER_KEY),
  };
}

const post = (body: object) => request(ctx.app.getHttpServer()).post('/v1/webhooks/midtrans').send(body);
const setProviderStatus = (reference: string, transaction_status: string, extra: Record<string, string> = {}) =>
  statusByOrder.set(reference, { transaction_status, status_code: transaction_status === 'settlement' ? '200' : '201', gross_amount: '309000.00', payment_type: 'bank_transfer', ...extra });

describe('Snap transaction', () => {
  it('offers only the methods enabled in configuration', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/payments/methods');
    expect(res.body).toMatchObject({ provider: 'MIDTRANS', mode: 'sandbox' });
    expect(res.body.methods.map((m: { id: string }) => m.id)).toEqual(['VA', 'QRIS']);
    const { pay } = await createPayment('EWALLET');
    expect(pay.status).toBe(400);
  });

  it('creates the Snap transaction server-side with the right amount, items, methods, expiry and finish URL', async () => {
    snapRequests.length = 0;
    const { pay, order } = await createPayment('VA');
    expect(pay.status).toBe(201);
    expect(pay.body).toMatchObject({ provider: 'MIDTRANS', status: 'PENDING', amount: 309_000 });
    expect(pay.body.redirectUrl).toMatch(/^https:\/\/app\.sandbox\.midtrans\.com\//);
    const [{ auth, body }] = snapRequests;
    expect(auth).toBe('Basic ' + Buffer.from(`${SERVER_KEY}:`).toString('base64'));
    expect(body.transaction_details).toEqual({ order_id: pay.body.reference, gross_amount: 309_000 });
    const itemsTotal = body.item_details.reduce((s: number, i: { price: number; quantity: number }) => s + i.price * i.quantity, 0);
    expect(itemsTotal).toBe(309_000);
    expect(body.item_details).toContainEqual({ id: 'service-fee', name: 'TicketPay service fee', price: 9_000, quantity: 1 });
    expect(body.enabled_payments).toEqual(['bca_va', 'bni_va', 'bri_va', 'permata_va', 'echannel']);
    expect(body.expiry).toMatchObject({ unit: 'minutes', duration: 15 });
    expect(body.expiry.start_time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+0700$/);
    expect(body.callbacks.finish).toBe(`http://localhost:3000/orders/${order.id}/status`);
    expect(body.customer_details).toEqual({ first_name: 'Rania Putri', email: 'buyer@ticketpay.example' });
  });

  it('mock outcomes are refused when the provider is Midtrans', async () => {
    const { pay, agent } = await createPayment('VA');
    expect((await agent.post(`/v1/dev/mock-payments/${pay.body.id}/simulate`).set(csrf).send({ outcome: 'paid' })).status).toBe(403);
  });
});

describe('notifications', () => {
  it('T5: rejects and logs a notification with an invalid signature', async () => {
    const { pay } = await createPayment();
    const res = await post(notification(pay.body.reference, 'settlement', { key: 'SB-Mid-server-WRONG' }));
    expect(res.status).toBe(401);
    const [p] = await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id));
    expect(p.status).toBe('PENDING');
    const rejected = await ctx.db.select().from(paymentWebhookEvents).where(and(eq(paymentWebhookEvents.outcome, 'REJECTED'), eq(paymentWebhookEvents.signatureValid, false)));
    expect(rejected.length).toBeGreaterThan(0);
    // The stored payload drops the signature and VA number.
    expect(JSON.stringify(rejected.at(-1)!.payloadRedacted)).not.toMatch(/signature_key|va_number/);
    const audit = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'webhook.signature_rejected'));
    expect(audit.length).toBeGreaterThan(0);
    expect((await post({ order_id: pay.body.reference })).status).toBe(401);
  });

  it('T1 via Midtrans: a verified settlement marks the payment paid, writes the ledger and issues tickets', async () => {
    const { pay, agent, order } = await createPayment();
    setProviderStatus(pay.body.reference, 'settlement');
    const res = await post(notification(pay.body.reference, 'settlement'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: 'APPLIED' });
    expect((await agent.get(`/v1/orders/${order.id}`)).body).toMatchObject({ status: 'PAID', payment: { status: 'PAID', paymentType: 'bank_transfer' }, tickets: { issued: 2 } });
    expect(await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, pay.body.id))).toHaveLength(3);

    // T4: the same notification again changes nothing.
    const again = await post(notification(pay.body.reference, 'settlement'));
    expect(again.body.outcome).toBe('DUPLICATE');
    expect(await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, pay.body.id))).toHaveLength(3);
    expect(await ctx.db.select().from(tickets).where(eq(tickets.paymentId, pay.body.id))).toHaveLength(2);
  });

  it('T6: a late "pending" after settlement is ignored', async () => {
    const { pay } = await createPayment();
    setProviderStatus(pay.body.reference, 'settlement');
    await post(notification(pay.body.reference, 'settlement'));
    // Simulate Midtrans delivering an older notification late, with the status API still answering "pending".
    setProviderStatus(pay.body.reference, 'pending');
    const late = await post(notification(pay.body.reference, 'pending'));
    expect(late.body.outcome).toBe('IGNORED_STALE');
    expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe('PAID');
  });

  it('trusts the Status API over the notification body', async () => {
    const { pay } = await createPayment();
    // A correctly signed "settlement" while Midtrans itself still says "pending": nothing is paid.
    setProviderStatus(pay.body.reference, 'pending');
    const res = await post(notification(pay.body.reference, 'settlement'));
    expect(res.body.outcome).toBe('DUPLICATE'); // pending -> pending: no change
    expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe('PENDING');
  });

  it('asks Midtrans to retry when the Status API is unreachable', async () => {
    const { pay } = await createPayment();
    statusApiDown = true;
    const res = await post(notification(pay.body.reference, 'settlement'));
    statusApiDown = false;
    expect(res.status).toBe(503);
    expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe('PENDING');
  });

  it('rejects a notification whose amount does not match the payment', async () => {
    const { pay } = await createPayment();
    setProviderStatus(pay.body.reference, 'settlement', { gross_amount: '1000.00' });
    const res = await post(notification(pay.body.reference, 'settlement', { gross_amount: '1000.00' }));
    expect(res.body.outcome).toBe('REJECTED');
    expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe('PENDING');
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'payment.amount_mismatch'), eq(auditLogs.entityId, pay.body.id)))).toHaveLength(1);
  });

  it('maps deny to failed, expire to expired, and capture with fraud deny to failed', async () => {
    for (const [status, fraud, expected] of [
      ['deny', undefined, 'FAILED'],
      ['expire', undefined, 'EXPIRED'],
      ['capture', 'deny', 'FAILED'],
    ] as const) {
      const { pay } = await createPayment();
      setProviderStatus(pay.body.reference, status, fraud ? { fraud_status: fraud } : {});
      const res = await post(notification(pay.body.reference, status, { fraud_status: fraud }));
      expect(res.body.outcome).toBe('APPLIED');
      expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe(expected);
    }
  });

  it('answers 200 for an unknown order so a dashboard test notification does not retry', async () => {
    const ref = 'PAY-UNKNOWN-1';
    setProviderStatus(ref, 'settlement');
    const res = await post(notification(ref, 'settlement'));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('UNSUPPORTED');
  });
});

describe('expiry with Midtrans', () => {
  it('checks Midtrans before expiring: a payment that settled is applied as paid', async () => {
    const { pay, order } = await createPayment();
    setProviderStatus(pay.body.reference, 'settlement');
    await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));
    const result = await ctx.app.get(PaymentsService).expireStale();
    expect(result.paid).toBe(1);
    expect((await ctx.db.select().from(payments).where(eq(payments.id, pay.body.id)))[0].status).toBe('PAID');
  });

  it('expires the order when Midtrans still says pending, and leaves it alone when Midtrans is unreachable', async () => {
    const a = await createPayment();
    await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, a.order.id));
    statusApiDown = true;
    await ctx.app.get(PaymentsService).expireStale();
    statusApiDown = false;
    expect((await ctx.db.select().from(payments).where(eq(payments.id, a.pay.body.id)))[0].status).toBe('PENDING');
    await ctx.app.get(PaymentsService).expireStale();
    expect((await ctx.db.select().from(payments).where(eq(payments.id, a.pay.body.id)))[0].status).toBe('EXPIRED');
  });
});
