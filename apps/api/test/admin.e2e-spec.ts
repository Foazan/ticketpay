// Admin dashboard API: merchant approval and suspension, event moderation, fee settings,
// simulated refunds, webhook retries, gate staff and the audit log. T20 for every admin route.
import {
  DEMO_PASSWORD,
  auditLogs,
  events,
  ledgerEntries,
  merchantWebhookDeliveries,
  merchants,
  orders,
  payments,
  ticketTiers,
  tickets,
} from '@ticketpay/database';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { PaymentsService } from '../src/payments/payments.service';
import { bootTestApp, csrf, waitFor, type TestContext } from './helpers';

let ctx: TestContext;
const ADMIN = 'admin@ticketpay.example';
const SLUG = 'soundwave-festival-2026'; // Arunika
const NUSA_SLUG = 'techconnect-indonesia'; // Nusa Konferensi
let regular: { id: string };
let arunikaId: string;
let nusaId: string;
let pentasId: string;

type Agent = Awaited<ReturnType<TestContext['login']>>;
const admin = () => ctx.login(ADMIN);

async function clearOpenOrders(email: string) {
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, email), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
}

async function order(email: string, slug: string, tierId: string, quantity = 1) {
  await clearOpenOrders(email);
  const agent = await ctx.login(email);
  const res = await agent.post('/v1/orders').set(csrf).send({ eventSlug: slug, items: [{ tierId, quantity }], checkoutKey: randomUUID(), buyerName: 'Rania Putri', buyerEmail: email });
  return { agent, res };
}

/** A paid purchase through the mock provider. */
async function buy(quantity = 2, email = 'buyer@ticketpay.example') {
  const { agent, res } = await order(email, SLUG, regular.id, quantity);
  expect(res.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: res.body.id, method: 'QRIS' });
  expect(payment.status).toBe(201);
  await agent.post(`/v1/dev/mock-payments/${payment.body.id}/simulate`).set(csrf).send({ outcome: 'paid' });
  await waitFor(async () => (await ctx.db.select().from(payments).where(eq(payments.id, payment.body.id)))[0].status === 'PAID', 5000, 'paid');
  return { orderId: res.body.id as string, paymentId: payment.body.id as string };
}

const tier = async (id: string) => (await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.id, id)))[0];
const auditFor = (action: string, entityId: string) =>
  ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)));

beforeAll(async () => {
  ctx = await bootTestApp();
  const [ev] = await ctx.db.select().from(events).where(eq(events.slug, SLUG));
  regular = (await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, ev.id))).find((t) => t.name === 'Regular')!;
  arunikaId = ev.merchantId;
  const all = await ctx.db.select().from(merchants);
  nusaId = all.find((m) => m.businessName === 'Nusa Konferensi')!.id;
  pentasId = all.find((m) => m.businessName === 'Pentas Kota Nusantara')!.id;
  await ctx.db.update(merchants).set({ webhookUrl: `${ctx.baseUrl}/v1/dev/webhook-receiver` }).where(eq(merchants.id, arunikaId));
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('T20: only administrators reach the admin API', () => {
  const reads = ['overview', 'merchants', 'events', 'payments', 'ledger', 'reconciliation', 'fees', 'webhooks', 'blockchain', 'gate-staff', 'audit-logs'];

  it('refuses anonymous clients, buyers, organizers and gate staff', async () => {
    for (const path of reads) expect((await ctx.http().get(`/v1/admin/${path}`)).status).toBe(401);
    for (const email of ['buyer@ticketpay.example', 'organizer@ticketpay.example', 'gate@ticketpay.example']) {
      const agent = await ctx.login(email);
      for (const path of reads) expect((await agent.get(`/v1/admin/${path}`)).status).toBe(403);
      expect((await agent.post(`/v1/admin/merchants/${pentasId}/approve`).set(csrf).send({})).status).toBe(403);
      expect((await agent.post('/v1/admin/fees').set(csrf).send({ feeRateBps: 0 })).status).toBe(403);
      expect((await agent.post(`/v1/payments/${randomUUID()}/refund`).set(csrf).send({ reason: 'not allowed here' })).status).toBe(403);
    }
  });

  it('serves every admin page to an administrator', async () => {
    const a = await admin();
    for (const path of reads) expect((await a.get(`/v1/admin/${path}`)).status).toBe(200);
  });
});

describe('overview', () => {
  it('counts come from the database', async () => {
    await buy(1);
    const res = await (await admin()).get('/v1/admin/overview');
    const paid = await ctx.db.select().from(payments).where(eq(payments.status, 'PAID'));
    expect(res.body.payments.PAID).toBe(paid.length);
    expect(res.body.merchants).toMatchObject({ APPROVED: 3, PENDING: 1 });
    const lines = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'GROSS_SALE'));
    expect(res.body.money.gross).toBe(lines.reduce((sum, l) => sum + l.amount, 0));
    expect(res.body.money.serviceFees).toBe(await feesOf(paid.map((p) => p.id)));
    expect(res.body.dailyVolume).toHaveLength(30);
    expect(res.body.dailyVolume.at(-1).revenue).toBeGreaterThan(0);
    expect(res.body.feeRateBps).toBe(300);
    expect(res.body.chain).toMatchObject({ mode: 'disabled', ready: false });
  });
});

/** Service fees inside these payments' amounts (the gross sale excludes them). */
async function feesOf(paymentIds: string[]) {
  let total = 0;
  for (const id of paymentIds) {
    const [p] = await ctx.db.select({ orderId: payments.orderId }).from(payments).where(eq(payments.id, id));
    const [o] = await ctx.db.select({ serviceFee: orders.serviceFee }).from(orders).where(eq(orders.id, p.orderId));
    total += o.serviceFee;
  }
  return total;
}

describe('merchant approval', () => {
  it('a pending organizer cannot publish until approved; rejection needs a reason; each decision is audited', async () => {
    const org = await ctx.login('organizer4@ticketpay.example');
    const cats = await org.get('/v1/categories');
    const categoryId = cats.body[0].id;
    const day = 24 * 3600 * 1000;
    const ev = await org.post('/v1/organizer/events').set(csrf).send({
      title: 'Bandung Street Theatre',
      categoryId,
      description: 'Open-air theatre performances along Jalan Braga for one evening.',
      city: 'Bandung',
      venue: 'Jalan Braga',
      startAt: new Date(Date.now() + 30 * day).toISOString(),
      endAt: new Date(Date.now() + 30 * day + 3 * 3600 * 1000).toISOString(),
      requiresIdCheck: false,
    });
    expect(ev.status).toBe(201);
    await org.post(`/v1/organizer/events/${ev.body.id}/tiers`).set(csrf).send({
      name: 'Regular',
      price: 50000,
      quota: 20,
      salesStartAt: new Date(Date.now() - day).toISOString(),
      salesEndAt: new Date(Date.now() + 29 * day).toISOString(),
    });
    expect((await org.post(`/v1/organizer/events/${ev.body.id}/publish`).set(csrf).send({})).status).toBe(403);

    const a = await admin();
    const list = await a.get('/v1/admin/merchants?status=PENDING');
    expect(list.body.map((m: { id: string }) => m.id)).toEqual([pentasId]);

    expect((await a.post(`/v1/admin/merchants/${pentasId}/reject`).set(csrf).send({})).status).toBe(400);
    expect((await a.post(`/v1/admin/merchants/${pentasId}/suspend`).set(csrf).send({ reason: 'Not approved yet' })).status).toBe(409);
    expect((await a.post(`/v1/admin/merchants/${pentasId}/promote`).set(csrf).send({})).status).toBe(404);

    const approved = await a.post(`/v1/admin/merchants/${pentasId}/approve`).set(csrf).send({});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', statusReason: null });
    expect(approved.body.history[0]).toMatchObject({ action: 'merchant.approved', actor: 'Platform Admin' });
    expect(await auditFor('merchant.approved', pentasId)).toHaveLength(1);
    expect((await a.post(`/v1/admin/merchants/${pentasId}/approve`).set(csrf).send({})).status).toBe(409);

    expect((await org.post(`/v1/organizer/events/${ev.body.id}/publish`).set(csrf).send({})).status).toBe(200);
    expect((await ctx.http().get('/v1/events/bandung-street-theatre')).status).toBe(200);
  });

  it('suspension hides the organizer’s events and stops new orders and payments; reactivation restores them', async () => {
    const [nusaEvent] = await ctx.db.select().from(events).where(eq(events.slug, NUSA_SLUG));
    const [nusaTier] = await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.eventId, nusaEvent.id));
    // An order placed before the suspension, not yet paid.
    const before = await order('buyer2@ticketpay.example', NUSA_SLUG, nusaTier.id);
    expect(before.res.status).toBe(201);

    const a = await admin();
    const res = await a.post(`/v1/admin/merchants/${nusaId}/suspend`).set(csrf).send({ reason: 'Documents under review' });
    expect(res.body).toMatchObject({ status: 'SUSPENDED', statusReason: 'Documents under review' });

    expect((await ctx.http().get(`/v1/events/${NUSA_SLUG}`)).status).toBe(404);
    const listing = await ctx.http().get('/v1/events');
    expect(JSON.stringify(listing.body)).not.toContain(NUSA_SLUG);
    const blocked = await before.agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: before.res.body.id, method: 'VA' });
    expect(blocked.status).toBe(403);
    const fresh = await ctx.login('buyer@ticketpay.example');
    await clearOpenOrders('buyer@ticketpay.example');
    const refused = await fresh.post('/v1/orders').set(csrf).send({ eventSlug: NUSA_SLUG, items: [{ tierId: nusaTier.id, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Rania', buyerEmail: 'buyer@ticketpay.example' });
    expect(refused.status).toBe(404);

    // The organizer sees why.
    const me = await (await ctx.login('organizer2@ticketpay.example')).get('/v1/organizer/merchant');
    expect(me.body).toMatchObject({ status: 'SUSPENDED', statusReason: 'Documents under review' });

    expect((await a.post(`/v1/admin/merchants/${nusaId}/approve`).set(csrf).send({})).status).toBe(200);
    expect((await ctx.http().get(`/v1/events/${NUSA_SLUG}`)).status).toBe(200);
    const audit = await auditFor('merchant.suspended', nusaId);
    expect(audit[0].metadata).toMatchObject({ from: 'APPROVED', reason: 'Documents under review' });
  });

  it('shows a merchant’s detail with events and figures', async () => {
    const res = await (await admin()).get(`/v1/admin/merchants/${arunikaId}`);
    expect(res.body.businessName).toBe('Arunika Live Entertainment');
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.paidPayments).toBeGreaterThan(0);
    expect((await (await admin()).get(`/v1/admin/merchants/${randomUUID()}`)).status).toBe(404);
  });
});

describe('event moderation', () => {
  it('an administrator can take a published event off sale, with a reason', async () => {
    const a = await admin();
    const [ev] = await ctx.db.select().from(events).where(eq(events.slug, 'bandung-street-theatre'));
    expect((await a.post(`/v1/admin/events/${ev.id}/unpublish`).set(csrf).send({})).status).toBe(400);
    expect((await a.post(`/v1/admin/events/${ev.id}/unpublish`).set(csrf).send({ reason: 'Venue permit missing' })).status).toBe(200);
    expect((await ctx.http().get('/v1/events/bandung-street-theatre')).status).toBe(404);
    expect((await a.post(`/v1/admin/events/${ev.id}/unpublish`).set(csrf).send({ reason: 'Venue permit missing' })).status).toBe(409);
    expect(await auditFor('event.unpublished_by_admin', ev.id)).toHaveLength(1);
    const list = await a.get('/v1/admin/events?status=UNPUBLISHED');
    expect(list.body.map((e: { id: string }) => e.id)).toContain(ev.id);
  });
});

describe('service fee settings', () => {
  it('a new rate applies to new quotes and orders only, and is capped at 10%', async () => {
    const a = await admin();
    const existing = await order('buyer2@ticketpay.example', SLUG, regular.id);
    expect(existing.res.body.feeRateBps).toBe(300);

    expect((await a.post('/v1/admin/fees').set(csrf).send({ feeRateBps: 1500 })).status).toBe(400);
    expect((await a.post('/v1/admin/fees').set(csrf).send({ feeRateBps: -1 })).status).toBe(400);
    const set = await a.post('/v1/admin/fees').set(csrf).send({ feeRateBps: 500, note: 'Test rate' });
    expect(set.status).toBe(201);
    expect(set.body.currentRateBps).toBe(500);
    expect(set.body.history[0]).toMatchObject({ feeRateBps: 500, note: 'Test rate', setBy: 'Platform Admin' });

    const quote = await ctx.http().get(`/v1/checkout/quote?event=${SLUG}&items=${regular.id}:1`);
    expect(quote.body).toMatchObject({ feeRateBps: 500, serviceFee: 7500 });
    const [kept] = await ctx.db.select().from(orders).where(eq(orders.id, existing.res.body.id));
    expect(kept).toMatchObject({ feeRateBps: 300, serviceFee: 4500 });

    await a.post('/v1/admin/fees').set(csrf).send({ feeRateBps: 300, note: 'Back to default' });
    const audits = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'fee.changed'));
    expect(audits.map((r) => r.metadata)).toEqual(expect.arrayContaining([expect.objectContaining({ from: 300, to: 500 })]));
  });
});

describe('simulated refund (POST /v1/payments/:id/refund)', () => {
  it('cancels the tickets, releases the quota, reverses the ledger and notifies the merchant', async () => {
    const { paymentId, orderId } = await buy(2);
    const soldBefore = (await tier(regular.id)).soldCount;
    const a = await admin();

    expect((await a.post(`/v1/payments/${paymentId}/refund`).set(csrf).send({ reason: 'x' })).status).toBe(400);
    const res = await a.post(`/v1/payments/${paymentId}/refund`).set(csrf).send({ reason: 'Buyer cannot attend' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paymentId, status: 'REFUNDED', alreadyRefunded: false });

    const [p] = await ctx.db.select().from(payments).where(eq(payments.id, paymentId));
    expect(p).toMatchObject({ status: 'REFUNDED', providerStatus: 'simulated_refund' });
    expect((await ctx.db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe('REFUNDED');
    const ts = await ctx.db.select().from(tickets).where(eq(tickets.paymentId, paymentId));
    expect(ts.map((t) => t.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect((await tier(regular.id)).soldCount).toBe(soldBefore - 2);

    // The ledger nets to zero for the merchant and the platform; the buyer's refund equals the amount paid.
    const lines = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId));
    const signed = (type: string) => lines.filter((l) => l.type === type).reduce((s, l) => s + (l.direction === 'CREDIT' ? l.amount : -l.amount), 0);
    expect(signed('MERCHANT_NET')).toBe(0);
    expect(signed('SERVICE_FEE')).toBe(0);
    expect(lines.find((l) => l.type === 'REFUND')).toMatchObject({ direction: 'DEBIT', amount: p.amount });

    const delivery = await waitFor(async () => {
      const [d] = await ctx.db
        .select()
        .from(merchantWebhookDeliveries)
        .where(and(eq(merchantWebhookDeliveries.paymentId, paymentId), eq(merchantWebhookDeliveries.eventType, 'payment.refunded')));
      return d?.status === 'DELIVERED' ? d : null;
    }, 10_000, 'payment.refunded delivery');
    expect(delivery.payload).toMatchObject({ type: 'payment.refunded' });

    // The buyer's ticket page shows the refund.
    const buyer = await ctx.login('buyer@ticketpay.example');
    const mine = await buyer.get(`/v1/tickets/${ts[0].id}`);
    expect(mine.body.status).toBe('CANCELLED');
    expect((await buyer.get(`/v1/tickets/${ts[0].id}/qr`)).status).toBeGreaterThanOrEqual(400);

    // Idempotent: a repeat changes nothing.
    const again = await a.post(`/v1/payments/${paymentId}/refund`).set(csrf).send({ reason: 'Buyer cannot attend' });
    expect(again.body).toMatchObject({ status: 'REFUNDED', alreadyRefunded: true });
    expect(await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId))).toHaveLength(lines.length);
    expect(await auditFor('payment.refund_simulated', paymentId)).toHaveLength(1);

    // Reconciliation agrees.
    const recon = await a.get('/v1/admin/reconciliation');
    const row = recon.body.rows.find((r: { paymentId: string }) => r.paymentId === paymentId);
    expect(row).toMatchObject({ status: 'MATCHED', merchant: 'Arunika Live Entertainment' });
  });

  it('refuses a payment that is not paid, one with an admitted ticket, and an unknown payment', async () => {
    const a = await admin();
    const { agent, res } = await order('buyer2@ticketpay.example', SLUG, regular.id);
    const pending = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: res.body.id, method: 'VA' });
    expect((await a.post(`/v1/payments/${pending.body.id}/refund`).set(csrf).send({ reason: 'Not paid yet' })).status).toBe(409);

    const { paymentId } = await buy(1);
    await ctx.db.update(tickets).set({ status: 'REDEEMED' }).where(eq(tickets.paymentId, paymentId));
    const blocked = await a.post(`/v1/payments/${paymentId}/refund`).set(csrf).send({ reason: 'Asked after entry' });
    expect(blocked.status).toBe(409);
    expect((await ctx.db.select().from(payments).where(eq(payments.id, paymentId)))[0].status).toBe('PAID');
    const detail = await a.get(`/v1/admin/payments/${paymentId}`);
    expect(detail.body.canRefund).toBe(false);

    expect((await a.post(`/v1/payments/${randomUUID()}/refund`).set(csrf).send({ reason: 'No such payment' })).status).toBe(404);
  });
});

describe('payments, ledger and reconciliation', () => {
  it('lists payments with filters and shows everything recorded about one', async () => {
    const a = await admin();
    const { paymentId } = await buy(1);
    const paid = await a.get(`/v1/admin/payments?status=PAID&merchantId=${arunikaId}`);
    expect(paid.body.every((p: { status: string; merchantId: string }) => p.status === 'PAID' && p.merchantId === arunikaId)).toBe(true);
    const [p] = await ctx.db.select().from(payments).where(eq(payments.id, paymentId));
    const search = await a.get(`/v1/admin/payments?q=${p.reference}`);
    expect(search.body.map((r: { id: string }) => r.id)).toEqual([paymentId]);

    const detail = await a.get(`/v1/admin/payments/${paymentId}`);
    expect(detail.body.payment).toMatchObject({ id: paymentId, status: 'PAID' });
    expect(detail.body.items).toEqual([expect.objectContaining({ tier: 'Regular', quantity: 1 })]);
    expect(detail.body.ledger).toHaveLength(3);
    expect(detail.body.tickets).toHaveLength(1);
    expect(detail.body.notifications.length).toBeGreaterThan(0);
    expect(detail.body.canRefund).toBe(true);
    expect(JSON.stringify(detail.body)).not.toMatch(/payloadRedacted|tokenHash|secret|passwordHash/i);
  });

  it('ledger totals add up across merchants', async () => {
    const res = await (await admin()).get('/v1/admin/ledger');
    const rows = await ctx.db.select().from(ledgerEntries);
    const sum = (dir: string) => rows.filter((r) => r.direction === dir).reduce((s, r) => s + r.amount, 0);
    const totals = res.body.totals as { credit: number; debit: number }[];
    expect(totals.reduce((s, t) => s + t.credit, 0)).toBe(sum('CREDIT'));
    expect(totals.reduce((s, t) => s + t.debit, 0)).toBe(sum('DEBIT'));
    const refunds = await (await admin()).get('/v1/admin/ledger?type=REFUND');
    expect(refunds.body.rows.every((r: { type: string }) => r.type === 'REFUND')).toBe(true);
  });
});

describe('merchant webhook monitoring', () => {
  it('retries a delivery that gave up, with the same event id', async () => {
    const a = await admin();
    const [d] = await ctx.db.select().from(merchantWebhookDeliveries).where(eq(merchantWebhookDeliveries.status, 'DELIVERED')).limit(1);
    expect((await a.post(`/v1/admin/webhooks/${d.id}/retry`).set(csrf).send({})).status).toBe(409);
    await ctx.db.update(merchantWebhookDeliveries).set({ status: 'FAILED', lastError: 'HTTP 503' }).where(eq(merchantWebhookDeliveries.id, d.id));
    const failed = await a.get('/v1/admin/webhooks?status=FAILED');
    expect(failed.body.map((r: { id: string }) => r.id)).toContain(d.id);

    const res = await a.post(`/v1/admin/webhooks/${d.id}/retry`).set(csrf).send({});
    expect(res.status).toBe(200);
    const after = await waitFor(async () => {
      const [row] = await ctx.db.select().from(merchantWebhookDeliveries).where(eq(merchantWebhookDeliveries.id, d.id));
      return row.status === 'DELIVERED' && row.attemptCount > d.attemptCount ? row : null;
    }, 10_000, 'redelivery');
    expect(after.eventId).toBe(d.eventId);
    expect(await auditFor('webhook.retried', d.id)).toHaveLength(1);
  });
});

describe('blockchain monitoring', () => {
  it('reports the chain as off and refuses retries in this environment', async () => {
    const a = await admin();
    const res = await a.get('/v1/admin/blockchain');
    expect(res.body.status).toMatchObject({ mode: 'disabled', ready: false });
    expect(Array.isArray(res.body.transactions)).toBe(true);
    const [t] = await ctx.db.select().from(tickets).limit(1);
    expect((await a.post(`/v1/admin/blockchain/tickets/${t.id}/retry`).set(csrf).send({ action: 'mint' })).status).toBe(409);
  });
});

describe('gate staff management', () => {
  let staffId: string;
  const email = 'gate3@ticketpay.example';

  it('creates a gate staff account that can sign in', async () => {
    const a = await admin();
    expect((await a.post('/v1/admin/gate-staff').set(csrf).send({ fullName: 'G', email, password: DEMO_PASSWORD })).status).toBe(400);
    const res = await a.post('/v1/admin/gate-staff').set(csrf).send({ fullName: 'Gate Staff Tiga', email, password: DEMO_PASSWORD });
    expect(res.status).toBe(201);
    staffId = res.body.id;
    expect((await a.post('/v1/admin/gate-staff').set(csrf).send({ fullName: 'Gate Staff Tiga', email, password: DEMO_PASSWORD })).status).toBe(409);
    const me = await (await ctx.login(email)).get('/v1/auth/me');
    expect(me.body.user).toMatchObject({ role: 'GATE_STAFF', email });
  });

  it('assigns and unassigns events; the gate app follows', async () => {
    const a = await admin();
    const [ev] = await ctx.db.select().from(events).where(eq(events.slug, SLUG));
    const staff = await ctx.login(email);
    expect((await staff.get('/v1/gate/events')).body).toEqual([]);

    const assigned = await a.post(`/v1/admin/gate-staff/${staffId}/events`).set(csrf).send({ eventId: ev.id });
    expect(assigned.status).toBe(201);
    // Assigning twice keeps one permission.
    const twice = await a.post(`/v1/admin/gate-staff/${staffId}/events`).set(csrf).send({ eventId: ev.id });
    const row = twice.body.find((s: { id: string }) => s.id === staffId);
    expect(row.events.map((e: { eventId: string }) => e.eventId)).toEqual([ev.id]);
    expect((await staff.get('/v1/gate/events')).body.map((e: { id: string }) => e.id)).toEqual([ev.id]);

    expect((await a.post(`/v1/admin/gate-staff/${staffId}/events`).set(csrf).send({ eventId: randomUUID() })).status).toBe(404);
    const buyerId = (await (await ctx.login('buyer@ticketpay.example')).get('/v1/auth/me')).body.user.id;
    expect((await a.post(`/v1/admin/gate-staff/${buyerId}/events`).set(csrf).send({ eventId: ev.id })).status).toBe(404);

    await a.delete(`/v1/admin/gate-staff/${staffId}/events/${ev.id}`).set(csrf);
    expect((await staff.get('/v1/gate/events')).body).toEqual([]);
    expect(await auditFor('gate_staff.assigned', staffId)).toHaveLength(1);
    expect(await auditFor('gate_staff.unassigned', staffId)).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('lists administrator actions newest first, with filters and pages', async () => {
    const a: Agent = await admin();
    const res = await a.get('/v1/admin/audit-logs?entityType=Merchant');
    expect(res.body.rows.length).toBeGreaterThanOrEqual(3);
    expect(res.body.rows.every((r: { entityType: string }) => r.entityType === 'Merchant')).toBe(true);
    expect(res.body.rows[0]).toMatchObject({ actor: 'Platform Admin', actorRole: 'ADMIN' });
    const times = res.body.rows.map((r: { createdAt: string }) => Date.parse(r.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(res.body.entityTypes).toEqual(expect.arrayContaining(['Merchant', 'Payment', 'PlatformFee']));

    const byAction = await a.get('/v1/admin/audit-logs?action=merchant.');
    expect(byAction.body.rows.every((r: { action: string }) => r.action.startsWith('merchant.'))).toBe(true);
    const page2 = await a.get('/v1/admin/audit-logs?page=2');
    expect(page2.body.page).toBe(2);
    expect((await a.get('/v1/admin/audit-logs?page=abc')).status).toBe(400);
  });
});
