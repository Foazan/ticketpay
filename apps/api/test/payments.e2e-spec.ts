// Payment Facilitator end-to-end tests with the mock provider.
// Test matrix: T1, T2, T3, T4, T6, T7, T8, T24, plus idempotency, merchant API keys and data isolation.
import {
  DEMO_PASSWORD,
  auditLogs,
  events,
  ledgerEntries,
  merchantWebhookDeliveries,
  merchants,
  orders,
  paymentWebhookEvents,
  payments,
  ticketTiers,
  tickets,
} from '@ticketpay/database';
import { WEBHOOK_HEADERS } from '@ticketpay/shared';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { signWebhook, verifyWebhook } from '../src/merchant-webhooks/signing';
import { WebhookWorker } from '../src/merchant-webhooks/webhook-worker';
import { PaymentsService } from '../src/payments/payments.service';
import { bootTestApp, csrf, waitFor, type TestContext } from './helpers';

let ctx: TestContext;
let regular: { id: string; price: number; quota: number }; // Soundwave Regular, Rp150.000
let vip: { id: string; price: number };
let arunikaId: string;

const SLUG = 'soundwave-festival-2026';

/**
 * Earlier tests leave unpaid orders behind, and a buyer may only hold 3 at once.
 * This expires a buyer's leftover holds through the real sweeper before a new checkout.
 */
async function clearOpenOrders(email: string) {
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, email), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
}

/** Checkout as a buyer: create the order and the payment. Returns both bodies. */
async function checkout(email: string, items: { tierId: string; quantity: number }[], method = 'VA') {
  await clearOpenOrders(email);
  const agent = await ctx.login(email);
  const order = await agent
    .post('/v1/orders')
    .set(csrf)
    .send({ eventSlug: SLUG, items, checkoutKey: randomUUID(), buyerName: 'Rania Putri', buyerEmail: email });
  expect(order.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method });
  expect(payment.status).toBe(201);
  return { agent, order: order.body, payment: payment.body };
}

async function simulate(email: string, paymentId: string, outcome: 'paid' | 'failed' | 'expired') {
  const agent = await ctx.login(email);
  return agent.post(`/v1/dev/mock-payments/${paymentId}/simulate`).set(csrf).send({ outcome });
}

const tier = async (id: string) => (await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.id, id)))[0];
const ledgerFor = (paymentId: string) => ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId));
const ticketsFor = (paymentId: string) => ctx.db.select().from(tickets).where(eq(tickets.paymentId, paymentId));
const deliveryFor = async (paymentId: string, type: string) =>
  (await ctx.db.select().from(merchantWebhookDeliveries).where(and(eq(merchantWebhookDeliveries.paymentId, paymentId), eq(merchantWebhookDeliveries.eventType, type))))[0];

/**
 * The quota invariant: for every tier, heldCount equals the tickets in PENDING orders,
 * and soldCount equals the tickets in PAID orders.
 */
async function expectQuotaConsistent() {
  const rows = await ctx.db.execute(sql`
    select t.id, t.held_count, t.sold_count,
      coalesce(sum(oi.quantity) filter (where o.status = 'PENDING'), 0)::int as pending,
      coalesce(sum(oi.quantity) filter (where o.status = 'PAID'), 0)::int as paid
    from ticket_tiers t
    left join order_items oi on oi.tier_id = t.id
    left join orders o on o.id = oi.order_id
    group by t.id`);
  const bad = (rows.rows as { held_count: number; sold_count: number; pending: number; paid: number }[]).filter(
    (r) => r.held_count !== r.pending || r.sold_count !== r.paid,
  );
  expect(bad).toEqual([]);
}

/** Points Arunika's webhook at `url`. The secret stays as seeded. */
const setArunikaWebhook = (url: string) => ctx.db.update(merchants).set({ webhookUrl: url }).where(eq(merchants.id, arunikaId));

beforeAll(async () => {
  ctx = await bootTestApp();
  const [ev] = await ctx.db.select().from(events).where(eq(events.slug, SLUG));
  const tiers = await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, ev.id));
  regular = tiers.find((t) => t.name === 'Regular')!;
  vip = tiers.find((t) => t.name === 'VIP')!;
  arunikaId = ev.merchantId;
  await setArunikaWebhook(`${ctx.baseUrl}/v1/dev/webhook-receiver`);
});

afterAll(() => ctx.close());

describe('quote and order creation', () => {
  it('prices a cart with the service fee shown separately', async () => {
    const res = await request(ctx.app.getHttpServer()).get(`/v1/checkout/quote?event=${SLUG}&items=${regular.id}:2,${vip.id}:1`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subtotal: 650_000, feeRateBps: 300, serviceFee: 19_500, total: 669_500 });
    expect(res.body.lines.map((l: { tierName: string; lineTotal: number }) => [l.tierName, l.lineTotal])).toEqual([
      ['Regular', 300_000],
      ['VIP', 350_000],
    ]);
  });

  it('rejects a tier from another event, too many tickets, and sales that have closed', async () => {
    const http = request(ctx.app.getHttpServer());
    const [other] = await ctx.db.select().from(ticketTiers).where(sql`${ticketTiers.eventId} <> (select id from events where slug = ${SLUG})`).limit(1);
    expect((await http.get(`/v1/checkout/quote?event=${SLUG}&items=${other.id}:1`)).status).toBe(400);
    expect((await http.get(`/v1/checkout/quote?event=${SLUG}&items=${regular.id}:7`)).status).toBe(400);
    await ctx.db.update(ticketTiers).set({ salesEndAt: new Date(Date.now() - 1000) }).where(eq(ticketTiers.id, vip.id));
    const closed = await http.get(`/v1/checkout/quote?event=${SLUG}&items=${vip.id}:1`);
    expect(closed.status).toBe(400);
    expect(closed.body.message).toMatch(/closed/);
    await ctx.db.update(ticketTiers).set({ salesEndAt: new Date('2026-12-18T16:59:00Z') }).where(eq(ticketTiers.id, vip.id));
  });

  it('holds quota for a new order, and a repeated checkoutKey returns the same order', async () => {
    const agent = await ctx.login('buyer@ticketpay.example');
    const before = await tier(regular.id);
    const body = { eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 2 }], checkoutKey: randomUUID(), buyerName: 'Rania Putri', buyerEmail: 'buyer@ticketpay.example' };
    const first = await agent.post('/v1/orders').set(csrf).send(body);
    const again = await agent.post('/v1/orders').set(csrf).send(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ status: 'PENDING', subtotal: 300_000, serviceFee: 9_000, total: 309_000, payment: null });
    expect((await tier(regular.id)).heldCount).toBe(before.heldCount + 2);
  });

  it('only buyers can create orders, and only the buyer can read an order', async () => {
    const organizer = await ctx.login('organizer@ticketpay.example');
    const body = { eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'X Y', buyerEmail: 'x@y.example' };
    expect((await organizer.post('/v1/orders').set(csrf).send(body)).status).toBe(403);
    const { order } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    const buyer2 = await ctx.login('buyer2@ticketpay.example');
    expect((await buyer2.get(`/v1/orders/${order.id}`)).status).toBe(404);
  });
});

describe('Payments API idempotency', () => {
  it('requires an Idempotency-Key', async () => {
    await clearOpenOrders('buyer2@ticketpay.example');
    const agent = await ctx.login('buyer2@ticketpay.example');
    const order = await agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' });
    const res = await agent.post('/v1/payments').set(csrf).send({ orderId: order.body.id, method: 'VA' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Idempotency-Key/);
  });

  it('replays the same payment for the same key, and refuses the key with a different body or a second key for the order', async () => {
    await clearOpenOrders('buyer2@ticketpay.example');
    const agent = await ctx.login('buyer2@ticketpay.example');
    const order = await agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' });
    const key = randomUUID();
    const first = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', key).send({ orderId: order.body.id, method: 'VA' });
    const replay = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', key).send({ orderId: order.body.id, method: 'VA' });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect((await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', key).send({ orderId: order.body.id, method: 'QRIS' })).status).toBe(409);
    expect((await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'VA' })).status).toBe(409);
    const rows = await ctx.db.select().from(payments).where(eq(payments.orderId, order.body.id));
    expect(rows).toHaveLength(1);
    expect(first.body).toMatchObject({ status: 'PENDING', provider: 'MOCK', amount: 154_500 });
    expect(first.body.redirectUrl).toBe(`http://localhost:3000/pay/mock/${first.body.id}`);
  });

  it('two concurrent requests with the same key create one payment', async () => {
    await clearOpenOrders('buyer2@ticketpay.example');
    const agent = await ctx.login('buyer2@ticketpay.example');
    const order = await agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' });
    const key = randomUUID();
    const send = () => agent.post('/v1/payments').set(csrf).set('Idempotency-Key', key).send({ orderId: order.body.id, method: 'VA' });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
  });
});

describe('payment outcomes', () => {
  it('T1: a successful payment marks the order paid, writes the ledger, issues tickets and sends a signed webhook', async () => {
    await clearOpenOrders('buyer@ticketpay.example');
    const before = await tier(regular.id);
    const { payment, agent, order } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 2 }]);
    const res = await simulate('buyer@ticketpay.example', payment.id, 'paid');
    expect(res.body).toMatchObject({ mock: true, outcome: 'APPLIED', status: 'PAID' });

    const view = await agent.get(`/v1/orders/${order.id}`);
    expect(view.body).toMatchObject({ status: 'PAID', payment: { status: 'PAID' }, tickets: { issued: 2, minted: 0 } });
    const after = await tier(regular.id);
    expect(after.soldCount).toBe(before.soldCount + 2);
    expect(after.heldCount).toBe(before.heldCount);
    await expectQuotaConsistent();

    const ledger = await ledgerFor(payment.id);
    expect(Object.fromEntries(ledger.map((l) => [l.type, l.amount]))).toEqual({ GROSS_SALE: 309_000, SERVICE_FEE: 9_000, MERCHANT_NET: 300_000 });

    const issued = await ticketsFor(payment.id);
    expect(issued.map((t) => t.seq).sort()).toEqual([1, 2]);
    expect(issued.every((t) => t.status === 'ACTIVE' && t.mintStatus === 'PENDING' && /^0x[0-9a-f]{64}$/.test(t.paymentRefHash))).toBe(true);
    expect(new Set(issued.map((t) => t.paymentRefHash)).size).toBe(2);

    const delivered = await waitFor(async () => {
      const d = await deliveryFor(payment.id, 'payment.paid');
      return d?.status === 'DELIVERED' ? d : null;
    }, 10_000, 'webhook delivery');
    expect(delivered.attemptCount).toBe(1);
    expect(delivered.payload).toMatchObject({ type: 'payment.paid', merchant_id: arunikaId, data: { amount: 309_000, status: 'PAID' } });
    const received = await (await ctx.login('organizer@ticketpay.example')).get('/v1/dev/webhook-receiver');
    expect(received.body.find((r: { eventId: string }) => r.eventId === delivered.eventId)).toMatchObject({ verified: true, duplicate: false });
  });

  it('T2: a failed payment issues no tickets and releases the held quota', async () => {
    await clearOpenOrders('buyer@ticketpay.example');
    const before = await tier(regular.id);
    const { payment, order, agent } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 3 }]);
    expect((await tier(regular.id)).heldCount).toBe(before.heldCount + 3);
    await simulate('buyer@ticketpay.example', payment.id, 'failed');
    expect((await agent.get(`/v1/orders/${order.id}`)).body).toMatchObject({ status: 'FAILED', payment: { status: 'FAILED' }, tickets: { issued: 0 } });
    const after = await tier(regular.id);
    expect(after.heldCount).toBe(before.heldCount);
    expect(after.soldCount).toBe(before.soldCount);
    expect(await ledgerFor(payment.id)).toHaveLength(0);
    expect(await ticketsFor(payment.id)).toHaveLength(0);
    await expectQuotaConsistent();
    await waitFor(async () => (await deliveryFor(payment.id, 'payment.failed'))?.status === 'DELIVERED', 10_000, 'failed webhook');
  });

  it('T3: an expired hold expires the payment, issues no tickets and releases quota; an abandoned order expires too', async () => {
    const { payment, order } = await checkout('buyer2@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    const agent = await ctx.login('buyer2@ticketpay.example');
    const abandoned = await agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: vip.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' });
    await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(sql`${orders.id} in (${order.id}, ${abandoned.body.id})`);

    const result = await ctx.app.get(PaymentsService).expireStale();
    expect(result.expired).toBeGreaterThanOrEqual(2);
    expect((await agent.get(`/v1/orders/${order.id}`)).body).toMatchObject({ status: 'EXPIRED', payment: { status: 'EXPIRED' }, tickets: { issued: 0 } });
    expect((await agent.get(`/v1/orders/${abandoned.body.id}`)).body.status).toBe('EXPIRED');
    await expectQuotaConsistent();
    // A late "paid" after expiry does not resurrect the payment.
    const late = await simulate('buyer2@ticketpay.example', payment.id, 'paid');
    expect(late.body.outcome).toBe('IGNORED_STALE');
    expect(await ticketsFor(payment.id)).toHaveLength(0);
    // Running the sweep again changes nothing.
    await ctx.app.get(PaymentsService).expireStale();
    await expectQuotaConsistent();
  });

  it('T4: a duplicate notification creates no second ledger entry, ticket or webhook', async () => {
    const { payment } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    const first = await simulate('buyer@ticketpay.example', payment.id, 'paid');
    const [second, third] = await Promise.all([simulate('buyer@ticketpay.example', payment.id, 'paid'), simulate('buyer@ticketpay.example', payment.id, 'paid')]);
    expect(first.body.outcome).toBe('APPLIED');
    expect([second.body.outcome, third.body.outcome]).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(await ledgerFor(payment.id)).toHaveLength(3);
    expect(await ticketsFor(payment.id)).toHaveLength(1);
    const deliveries = await ctx.db.select().from(merchantWebhookDeliveries).where(eq(merchantWebhookDeliveries.paymentId, payment.id));
    expect(deliveries).toHaveLength(1);
  });

  it('T6: an out-of-order notification does not move a paid payment backwards', async () => {
    const { payment, order, agent } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    await simulate('buyer@ticketpay.example', payment.id, 'paid');
    const before = await tier(regular.id);
    const stale = await simulate('buyer@ticketpay.example', payment.id, 'failed');
    expect(stale.body).toMatchObject({ outcome: 'IGNORED_STALE', status: 'PAID' });
    expect((await agent.get(`/v1/orders/${order.id}`)).body.status).toBe('PAID');
    expect(await tier(regular.id)).toMatchObject({ soldCount: before.soldCount, heldCount: before.heldCount });
    const events = await ctx.db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.paymentId, payment.id));
    expect(events.map((e) => e.outcome).sort()).toEqual(['APPLIED', 'IGNORED_STALE']);
    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, payment.id), eq(auditLogs.action, 'payment.status_changed')));
    expect(audit).toHaveLength(1);
    await expectQuotaConsistent();
  });

  it("a buyer cannot simulate another buyer's payment", async () => {
    const { payment } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    expect((await simulate('buyer2@ticketpay.example', payment.id, 'paid')).status).toBe(404);
  });
});

describe('T24: quota cannot be oversold', () => {
  it('lets exactly the remaining number of buyers hold the last tickets', async () => {
    // Leave exactly 2 Regular tickets.
    const t = await tier(regular.id);
    await ctx.db.update(ticketTiers).set({ quota: t.soldCount + t.heldCount + 2 }).where(eq(ticketTiers.id, regular.id));
    const http = request(ctx.app.getHttpServer());
    const agents = await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => {
        const email = `race${i}@ticketpay.example`;
        const agent = request.agent(ctx.app.getHttpServer());
        await agent.post('/v1/auth/register').set(csrf).send({ email, password: DEMO_PASSWORD, fullName: `Race Buyer ${i}` }).expect(201);
        return { agent, email };
      }),
    );
    const results = await Promise.all(
      agents.map(({ agent, email }) =>
        agent.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Race Buyer', buyerEmail: email }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const after = await tier(regular.id);
    expect(after.soldCount + after.heldCount).toBe(after.quota);
    expect((await http.get(`/v1/events/${SLUG}`)).body.tiers[0].available).toBe(0);
  });

  it('the database itself refuses an oversold tier', async () => {
    await expect(ctx.db.update(ticketTiers).set({ soldCount: sql`${ticketTiers.quota} + 1` }).where(eq(ticketTiers.id, regular.id))).rejects.toThrow();
    await ctx.db.update(ticketTiers).set({ quota: 1000 }).where(eq(ticketTiers.id, regular.id));
  });
});

describe('merchant webhooks', () => {
  let server: Server;
  let serverUrl: string;
  // The endpoint fails the first `failTimes` attempts of every event. Other deliveries (for example
  // expiry webhooks from earlier tests) therefore cannot use up the failures meant for one event.
  let failTimes = 0;
  const attemptsByEvent = new Map<string, number>();
  const hits: { eventId: string; headers: IncomingMessage['headers']; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const eventId = req.headers[WEBHOOK_HEADERS.eventId] as string;
        hits.push({ eventId, headers: req.headers, body });
        const n = (attemptsByEvent.get(eventId) ?? 0) + 1;
        attemptsByEvent.set(eventId, n);
        if (n <= failTimes) res.writeHead(503).end();
        else res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
  });

  afterAll(async () => {
    await setArunikaWebhook(`${ctx.baseUrl}/v1/dev/webhook-receiver`);
    await new Promise((r) => server.close(r));
  });

  it('T7: a failing merchant endpoint is retried with backoff, with the same event id and no duplicate business effect', async () => {
    await setArunikaWebhook(serverUrl);
    failTimes = 2;
    const { payment } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    await simulate('buyer@ticketpay.example', payment.id, 'paid');
    const d = await waitFor(async () => {
      const row = await deliveryFor(payment.id, 'payment.paid');
      return row?.status === 'DELIVERED' ? row : null;
    }, 15_000, 'delivery after retries');
    expect(d.attemptCount).toBe(3);
    expect(d.lastStatusCode).toBe(204);
    expect(hits.filter((h) => h.eventId === d.eventId)).toHaveLength(3);
    expect(await ledgerFor(payment.id)).toHaveLength(3);
    expect(await ticketsFor(payment.id)).toHaveLength(1);
  });

  it('gives up after the maximum attempts and records the failure', async () => {
    await setArunikaWebhook(serverUrl);
    failTimes = 100;
    const { payment } = await checkout('buyer@ticketpay.example', [{ tierId: regular.id, quantity: 1 }]);
    await simulate('buyer@ticketpay.example', payment.id, 'paid');
    const d = await waitFor(async () => {
      const row = await deliveryFor(payment.id, 'payment.paid');
      return row?.status === 'FAILED' ? row : null;
    }, 15_000, 'failed delivery');
    expect(d).toMatchObject({ attemptCount: 4, lastStatusCode: 503, lastError: 'HTTP 503' });
    // The payment itself is unaffected by the merchant's endpoint.
    expect((await ctx.db.select().from(payments).where(eq(payments.id, payment.id)))[0].status).toBe('PAID');
    failTimes = 0;
  });

  it('a redelivered job for a finished delivery sends nothing', async () => {
    const [delivered] = await ctx.db.select().from(merchantWebhookDeliveries).where(eq(merchantWebhookDeliveries.status, 'DELIVERED')).limit(1);
    const before = hits.length;
    const result = await ctx.app.get(WebhookWorker).deliver(delivered.id, 0, 4);
    expect(result).toBe('DELIVERED');
    expect(hits.length).toBe(before);
  });

  it('signs deliveries so the merchant can verify them', async () => {
    const hit = hits.find((h) => JSON.parse(h.body).type === 'payment.paid')!;
    expect(hit.headers[WEBHOOK_HEADERS.signature]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(JSON.parse(hit.body)).toMatchObject({ type: 'payment.paid', merchant_id: arunikaId });
  });
});

describe('T8: webhook signature verification', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.paid' });
  const now = 1_800_000_000;

  it('accepts a correct signature and rejects a wrong secret, a tampered body and a stale timestamp', () => {
    const sig = signWebhook(secret, now, body);
    expect(verifyWebhook(secret, { timestamp: String(now), signature: sig }, body, now)).toEqual({ ok: true });
    expect(verifyWebhook('whsec_wrong', { timestamp: String(now), signature: sig }, body, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(secret, { timestamp: String(now), signature: sig }, body.replace('paid', 'failed'), now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(secret, { timestamp: String(now), signature: sig }, body, now + 301)).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifyWebhook(secret, { timestamp: String(now + 10), signature: sig }, body, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(secret, {}, body, now)).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('the demo receiver rejects a forged delivery', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const forged = JSON.stringify({ id: 'evt_forged', type: 'payment.paid', merchant_id: arunikaId });
    const res = await request(ctx.app.getHttpServer())
      .post('/v1/dev/webhook-receiver')
      .set('content-type', 'application/json')
      .set(WEBHOOK_HEADERS.eventId, 'evt_forged')
      .set(WEBHOOK_HEADERS.timestamp, String(ts))
      .set(WEBHOOK_HEADERS.signature, signWebhook('whsec_guess', ts, forged))
      .send(forged);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bad_signature/);
  });
});

describe('merchant API keys and data isolation', () => {
  it('lets a merchant create and read payments with its API key, and only its own', async () => {
    const organizer = await ctx.login('organizer@ticketpay.example');
    const created = await organizer.post('/v1/organizer/api-keys').set(csrf);
    expect(created.status).toBe(201);
    const key: string = created.body.apiKey;
    expect(key).toMatch(/^tp_test_[0-9a-f]{8}\./);
    const listed = await organizer.get('/v1/organizer/api-keys');
    expect(JSON.stringify(listed.body)).not.toContain(key);

    // A buyer's order on Arunika's event, paid for through Arunika's server.
    await clearOpenOrders('buyer2@ticketpay.example');
    const buyer = await ctx.login('buyer2@ticketpay.example');
    const order = await buyer.post('/v1/orders').set(csrf).send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Bima Santoso', buyerEmail: 'buyer2@ticketpay.example' });
    const http = request(ctx.app.getHttpServer());
    const pay = await http.post('/v1/payments').set('authorization', `Bearer ${key}`).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'QRIS' });
    expect(pay.status).toBe(201);
    expect((await http.get(`/v1/payments/${pay.body.id}`).set('authorization', `Bearer ${key}`)).status).toBe(200);
    expect((await http.get(`/v1/payments/${pay.body.id}`).set('authorization', 'Bearer tp_test_00000000.nope')).status).toBe(401);

    // Another merchant's key cannot see it.
    const admin = await ctx.login('admin@ticketpay.example');
    const other = await admin.post('/v1/merchants').set(csrf).send({
      email: 'merchant.api@ticketpay.example',
      password: 'a-long-password',
      fullName: 'Api Merchant',
      businessName: 'Api Merchant Co',
      organizerType: 'Event promoter',
      contactPerson: 'Api Merchant',
      phone: '081299990000',
      address: 'Jl. Contoh 2, Malang',
    });
    expect(other.status).toBe(201);
    expect(other.body).toMatchObject({ status: 'APPROVED' });
    expect((await http.get(`/v1/payments/${pay.body.id}`).set('authorization', `Bearer ${other.body.apiKey}`)).status).toBe(404);
    expect((await http.post('/v1/payments').set('authorization', `Bearer ${other.body.apiKey}`).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'VA' })).status).toBe(404);

    // A revoked key stops working.
    await organizer.delete(`/v1/organizer/api-keys/${created.body.id}`).set(csrf).expect(200);
    expect((await http.get(`/v1/payments/${pay.body.id}`).set('authorization', `Bearer ${key}`)).status).toBe(401);
  });

  it("T21: an organizer sees only their own merchant's transactions, ledger and webhook deliveries", async () => {
    const arunika = await ctx.login('organizer@ticketpay.example');
    const nusa = await ctx.login('organizer2@ticketpay.example');
    const [tx, ledger, hooks] = await Promise.all([arunika.get('/v1/organizer/transactions'), arunika.get('/v1/organizer/ledger'), arunika.get('/v1/organizer/webhook-deliveries')]);
    expect(tx.body.length).toBeGreaterThan(0);
    expect(ledger.body.length).toBeGreaterThan(0);
    expect(hooks.body.length).toBeGreaterThan(0);
    expect((await nusa.get('/v1/organizer/transactions')).body).toEqual([]);
    expect((await nusa.get('/v1/organizer/ledger')).body).toEqual([]);
    expect((await nusa.get('/v1/organizer/webhook-deliveries')).body).toEqual([]);
  });

  it('organizer dashboard figures come from the ledger and paid orders', async () => {
    const arunika = await ctx.login('organizer@ticketpay.example');
    const overview = (await arunika.get('/v1/organizer/overview')).body;
    const [{ net }] = await ctx.db
      .select({ net: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)`.mapWith(Number) })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.merchantId, arunikaId), eq(ledgerEntries.type, 'MERCHANT_NET')));
    expect(overview.estimatedBalance).toBe(net);
    expect(overview.ticketsSold).toBeGreaterThan(0);
  });

  it('accepts webhook URLs over https, or http for localhost in development only', async () => {
    const organizer = await ctx.login('organizer2@ticketpay.example');
    expect((await organizer.put('/v1/organizer/webhook').set(csrf).send({ url: 'ftp://example.com/x' })).status).toBe(400);
    expect((await organizer.put('/v1/organizer/webhook').set(csrf).send({ url: 'http://example.com/x' })).status).toBe(400);
    const ok = await organizer.put('/v1/organizer/webhook').set(csrf).send({ url: 'https://nusa.example/hooks' });
    expect(ok.status).toBe(200);
    expect(ok.body.webhookSecret).toMatch(/^whsec_/);
    const again = await organizer.put('/v1/organizer/webhook').set(csrf).send({ url: 'https://nusa.example/hooks2' });
    expect(again.body.webhookSecret).toBeUndefined();
    const [m] = await ctx.db.select().from(merchants).where(eq(merchants.businessName, 'Nusa Konferensi'));
    expect(m.webhookSecretEnc).not.toContain(ok.body.webhookSecret);
  });
});
