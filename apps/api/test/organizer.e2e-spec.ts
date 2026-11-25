// Organizer dashboard API: event and ticket category management, posters, publishing rules,
// reporting and reconciliation. T20 and T21 for every write route, and T24 through quota edits.
import { events, ledgerEntries, merchants, orders, ticketTiers, tickets } from '@ticketpay/database';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentsService } from '../src/payments/payments.service';
import { bootTestApp, csrf, type TestContext } from './helpers';

let ctx: TestContext;
let categoryId: string;
const ORG = 'organizer@ticketpay.example'; // Arunika, approved
const ORG2 = 'organizer2@ticketpay.example'; // Nusa, approved
const PENDING_ORG = 'organizer4@ticketpay.example'; // Pentas, waiting for approval

type Agent = Awaited<ReturnType<TestContext['login']>>;
const day = 24 * 3600 * 1000;
const future = (days: number) => new Date(Date.now() + days * day).toISOString();

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

const eventBody = (over: Record<string, unknown> = {}) => ({
  title: 'Malang Jazz Evening',
  categoryId,
  description: 'An evening of Indonesian jazz trios and a late jam session by the river.',
  city: 'Malang',
  venue: 'Taman Rekreasi Senaputra',
  startAt: future(40),
  endAt: new Date(Date.now() + 40 * day + 4 * 3600 * 1000).toISOString(),
  requiresIdCheck: false,
  ...over,
});
const tierBody = (over: Record<string, unknown> = {}) => ({ name: 'Regular', price: 120000, quota: 50, salesStartAt: future(-1), salesEndAt: future(39), ...over });

async function createEvent(agent: Agent, over: Record<string, unknown> = {}) {
  const res = await agent.post('/v1/organizer/events').set(csrf).send(eventBody(over));
  if (res.status !== 201) throw new Error(`Create event failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; slug: string; status: string; posterPath: string; tiers: { id: string; name: string; tierCode: number }[] };
}

/** A buyer purchase on `slug`, paid through the mock provider. */
async function buy(slug: string, tierId: string, quantity = 1) {
  const agent = await ctx.login('buyer2@ticketpay.example');
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, 'buyer2@ticketpay.example'), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
  const order = await agent
    .post('/v1/orders')
    .set(csrf)
    .send({ eventSlug: slug, items: [{ tierId, quantity }], checkoutKey: randomUUID(), buyerName: 'Dewi', buyerEmail: 'buyer2@ticketpay.example' });
  expect(order.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'QRIS' });
  await agent.post(`/v1/dev/mock-payments/${payment.body.id}/simulate`).set(csrf).send({ outcome: 'paid' });
  return { orderId: order.body.id as string, paymentId: payment.body.id as string };
}

beforeAll(async () => {
  ctx = await bootTestApp({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'tp-uploads-')) });
  const cats = await (await ctx.login(ORG)).get('/v1/categories');
  categoryId = cats.body.find((c: { name: string }) => c.name === 'Music & Concert').id;
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('event management', () => {
  it('creates a draft with a generated poster, adds tiers, publishes, and the event goes on sale', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org);
    expect(ev).toMatchObject({ status: 'DRAFT', slug: 'malang-jazz-evening', tiers: [] });
    expect(ev.posterPath).toMatch(/^\/media\/posters\/[0-9a-f-]{36}\.svg$/);
    const poster = await ctx.http().get(ev.posterPath);
    expect(poster.status).toBe(200);
    expect(poster.headers['content-type']).toContain('image/svg+xml');
    expect(poster.headers['cross-origin-resource-policy']).toBe('cross-origin');

    // Drafts are not public.
    expect((await ctx.http().get(`/v1/events/${ev.slug}`)).status).toBe(404);
    // Publishing needs a ticket category.
    expect((await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf)).status).toBe(409);

    const withTiers = await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody());
    expect(withTiers.status).toBe(201);
    const vip = await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody({ name: 'VIP', price: 350000, quota: 10 }));
    expect(vip.body.tiers.map((t: { name: string; tierCode: number }) => [t.name, t.tierCode])).toEqual([
      ['Regular', 1],
      ['VIP', 2],
    ]);
    // Names are unique per event.
    expect((await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody())).status).toBe(409);

    const pub = await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('PUBLISHED');
    const publicView = await ctx.http().get(`/v1/events/${ev.slug}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.tiers).toHaveLength(2);

    const { paymentId } = await buy(ev.slug, withTiers.body.tiers[0].id, 2);
    expect(await ctx.db.select().from(tickets).where(eq(tickets.paymentId, paymentId))).toHaveLength(2);

    // Unpublish hides it; tickets sold stay valid.
    expect((await org.post(`/v1/organizer/events/${ev.id}/unpublish`).set(csrf)).body.status).toBe('UNPUBLISHED');
    expect((await ctx.http().get(`/v1/events/${ev.slug}`)).status).toBe(404);
    expect((await ctx.db.select().from(tickets).where(eq(tickets.paymentId, paymentId))).every((t) => t.status === 'ACTIVE')).toBe(true);
    // It has orders, so it cannot be deleted, only archived.
    expect((await org.delete(`/v1/organizer/events/${ev.id}`).set(csrf)).status).toBe(409);
    expect((await org.post(`/v1/organizer/events/${ev.id}/archive`).set(csrf)).body.status).toBe('ARCHIVED');
    expect((await org.patch(`/v1/organizer/events/${ev.id}`).set(csrf).send({ title: 'Renamed' })).status).toBe(409);
  });

  it('validates event and tier data on the server', async () => {
    const org = await ctx.login(ORG);
    for (const bad of [{ title: 'Ab' }, { endAt: future(39) }, { startAt: future(-1), endAt: future(1) }, { categoryId: 'nope' }, { description: 'too short' }]) {
      expect((await org.post('/v1/organizer/events').set(csrf).send(eventBody(bad))).status).toBe(400);
    }
    const ev = await createEvent(org, { title: 'Validation Night' });
    for (const bad of [{ price: 0 }, { price: 500 }, { quota: 0 }, { salesEndAt: future(-2) }, { salesEndAt: future(60) }, { name: '' }]) {
      expect((await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody(bad))).status).toBe(400);
    }
  });

  it('T24: a quota can never be lowered below what is sold or held', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org, { title: 'Quota Test Night' });
    const withTier = await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody({ quota: 5 }));
    const tierId = withTier.body.tiers[0].id;
    await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf);
    await buy(ev.slug, tierId, 3);
    const tooLow = await org.patch(`/v1/organizer/events/${ev.id}/tiers/${tierId}`).set(csrf).send({ quota: 2 });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.message).toContain('3 tickets already sold or held');
    expect((await org.patch(`/v1/organizer/events/${ev.id}/tiers/${tierId}`).set(csrf).send({ quota: 3 })).body.tiers[0].quota).toBe(3);
    // Sold out now: a further purchase is refused.
    const buyer = await ctx.login('buyer@ticketpay.example');
    const order = await buyer
      .post('/v1/orders')
      .set(csrf)
      .send({ eventSlug: ev.slug, items: [{ tierId, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Rania', buyerEmail: 'buyer@ticketpay.example' });
    expect(order.status).toBe(409);
    // A category with orders cannot be removed.
    expect((await org.delete(`/v1/organizer/events/${ev.id}/tiers/${tierId}`).set(csrf)).status).toBe(409);
    const [tier] = await ctx.db.select().from(ticketTiers).where(eq(ticketTiers.id, tierId));
    expect(tier.soldCount).toBe(3);
  });

  it('a pending organizer can prepare drafts but cannot publish', async () => {
    const org = await ctx.login(PENDING_ORG);
    const ev = await createEvent(org, { title: 'Pentas Rehearsal' });
    await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody());
    const res = await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('approved');
    // The check reads the merchant fresh, so approval takes effect without a new login.
    const [pentas] = await ctx.db.select().from(merchants).where(eq(merchants.businessName, 'Pentas Kota Nusantara'));
    expect(pentas).toBeDefined();
    {
      await ctx.db.update(merchants).set({ status: 'APPROVED' }).where(eq(merchants.id, pentas.id));
      expect((await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf)).status).toBe(200);
      await ctx.db.update(merchants).set({ status: 'PENDING' }).where(eq(merchants.id, pentas.id));
    }
  });

  it('deletes an event that never had orders, and edits regenerate a generated poster', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org, { title: 'Draft To Delete' });
    const renamed = await org.patch(`/v1/organizer/events/${ev.id}`).set(csrf).send({ title: 'Draft Renamed' });
    expect(renamed.body.title).toBe('Draft Renamed');
    expect(renamed.body.posterPath).not.toBe(ev.posterPath);
    expect((await ctx.http().get(ev.posterPath)).status).toBe(404);
    expect((await org.delete(`/v1/organizer/events/${ev.id}`).set(csrf)).status).toBe(200);
    expect((await org.get(`/v1/organizer/events/${ev.id}`)).status).toBe(404);
  });
});

describe('posters', () => {
  it('accepts PNG, JPEG and WebP by content, and rejects anything else', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org, { title: 'Poster Upload Test' });
    const ok = await org.post(`/v1/organizer/events/${ev.id}/poster`).set(csrf).attach('poster', PNG, { filename: 'poster.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.posterPath).toMatch(/\.png$/);
    const served = await ctx.http().get(ok.body.posterPath);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');

    // An uploaded poster is kept when the title changes.
    expect((await org.patch(`/v1/organizer/events/${ev.id}`).set(csrf).send({ title: 'Poster Upload Renamed' })).body.posterPath).toBe(ok.body.posterPath);

    const jpeg = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), Buffer.alloc(64)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(64)]);
    for (const [buf, ext] of [
      [jpeg, 'jpg'],
      [webp, 'webp'],
    ] as const) {
      // The declared type is ignored; the bytes decide.
      const res = await org.post(`/v1/organizer/events/${ev.id}/poster`).set(csrf).attach('poster', buf, { filename: 'upload.bin', contentType: 'application/octet-stream' });
      expect(res.status).toBe(200);
      expect(res.body.posterPath.endsWith(`.${ext}`)).toBe(true);
    }

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    for (const [buf, name, type] of [
      [svg, 'evil.svg', 'image/svg+xml'],
      [html, 'evil.png', 'image/png'],
    ] as const) {
      const res = await org.post(`/v1/organizer/events/${ev.id}/poster`).set(csrf).attach('poster', buf, { filename: name, contentType: type });
      expect(res.status).toBe(400);
    }
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect([400, 413]).toContain((await org.post(`/v1/organizer/events/${ev.id}/poster`).set(csrf).attach('poster', big, { filename: 'big.png', contentType: 'image/png' })).status);
    for (const name of ['../../etc/passwd', 'x.png', '..%2F..%2Fpackage.json']) expect((await ctx.http().get(`/media/posters/${name}`)).status).toBe(404);
  });
});

describe('isolation', () => {
  it('T21: an organizer cannot read or change another organizer’s events, tiers or data', async () => {
    const org = await ctx.login(ORG);
    const other = await ctx.login(ORG2);
    const ev = await createEvent(org, { title: 'Arunika Private Draft' });
    const withTier = await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody());
    const tierId = withTier.body.tiers[0].id;
    const attempts = [
      other.get(`/v1/organizer/events/${ev.id}`),
      other.patch(`/v1/organizer/events/${ev.id}`).set(csrf).send({ title: 'Hijacked' }),
      other.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf),
      other.post(`/v1/organizer/events/${ev.id}/archive`).set(csrf),
      other.delete(`/v1/organizer/events/${ev.id}`).set(csrf),
      other.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody({ name: 'Sneaky' })),
      other.patch(`/v1/organizer/events/${ev.id}/tiers/${tierId}`).set(csrf).send({ price: 1000 }),
      other.delete(`/v1/organizer/events/${ev.id}/tiers/${tierId}`).set(csrf),
      other.post(`/v1/organizer/events/${ev.id}/poster`).set(csrf).attach('poster', PNG, { filename: 'p.png', contentType: 'image/png' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    const [after] = await ctx.db.select().from(events).where(eq(events.id, ev.id));
    expect(after).toMatchObject({ title: 'Arunika Private Draft', status: 'DRAFT', deletedAt: null });
    expect((await other.get('/v1/organizer/events')).body.map((e: { id: string }) => e.id)).not.toContain(ev.id);
    const txs = await other.get('/v1/organizer/transactions');
    const arunikaOrders = await ctx.db.select({ id: orders.id }).from(orders).where(eq(orders.merchantId, (await org.get('/v1/organizer/merchant')).body.id));
    const otherIds = new Set(txs.body.map((t: { orderId: string }) => t.orderId));
    expect(arunikaOrders.some((o) => otherIds.has(o.id))).toBe(false);
    const { payments } = await import('@ticketpay/database');
    const arunikaPayments = new Set(
      (await ctx.db.select({ id: payments.id }).from(payments).where(eq(payments.merchantId, (await org.get('/v1/organizer/merchant')).body.id))).map((p) => p.id),
    );
    expect(arunikaPayments.size).toBeGreaterThan(0);
    const rec = await other.get('/v1/organizer/reconciliation');
    expect(rec.body.rows.some((r: { paymentId: string }) => arunikaPayments.has(r.paymentId))).toBe(false);
  });

  it('T20: buyers, gate staff and admins cannot use organizer routes', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org, { title: 'Role Check Draft' });
    for (const email of ['buyer@ticketpay.example', 'gate@ticketpay.example', 'admin@ticketpay.example']) {
      const agent = await ctx.login(email);
      for (const res of await Promise.all([
        agent.get('/v1/organizer/overview'),
        agent.get('/v1/organizer/analytics'),
        agent.get('/v1/organizer/reconciliation'),
        agent.post('/v1/organizer/events').set(csrf).send(eventBody()),
        agent.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf),
        agent.patch('/v1/organizer/merchant').set(csrf).send({ contactPerson: 'X', phone: '08123456789', address: 'Somewhere 1' }),
      ])) {
        expect(res.status).toBe(403);
      }
    }
  });
});

describe('reporting', () => {
  it('overview, analytics, transactions and ledger agree with each other', async () => {
    const org = await ctx.login(ORG);
    const ov = await org.get('/v1/organizer/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.dailySales).toHaveLength(30);
    expect(ov.body.recentTransactions.length).toBeGreaterThan(0);
    const an = await org.get('/v1/organizer/analytics?days=30');
    const soldByTier = an.body.byTier.reduce((s: number, t: { sold: number }) => s + t.sold, 0);
    expect(soldByTier).toBe(ov.body.ticketsSold);
    const revenueByTier = an.body.byTier.reduce((s: number, t: { revenue: number }) => s + t.revenue, 0);
    expect(revenueByTier).toBe(ov.body.totalRevenue);
    const fees = an.body.feeBreakdown;
    expect(fees.serviceFee + fees.organizerNet).toBe(fees.gross - fees.refunds);
    expect(fees.organizerNet).toBe(ov.body.estimatedBalance);
    // Today (WIB) is the last bucket, and everything paid in this run lands in it.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    expect(ov.body.dailySales.at(-1).date).toBe(today);
    expect(ov.body.dailySales.reduce((s: number, d: { revenue: number }) => s + d.revenue, 0)).toBe(ov.body.totalRevenue);
    // The events list sums each event's own tiers.
    const list = await org.get('/v1/organizer/events');
    for (const e of list.body) {
      const tiers = an.body.byTier.filter((t: { eventId: string }) => t.eventId === e.id);
      expect(e.sold).toBe(tiers.reduce((s: number, t: { sold: number }) => s + t.sold, 0));
      expect(e.quota).toBe(tiers.reduce((s: number, t: { quota: number }) => s + t.quota, 0));
      expect(e.tierCount).toBe(tiers.length);
    }
    expect(list.body.some((e: { quota: number }) => e.quota > 0)).toBe(true);
    const txs = await org.get('/v1/organizer/transactions?status=PAID');
    expect(txs.body.every((t: { orderStatus: string }) => t.orderStatus === 'PAID')).toBe(true);
    expect(txs.body[0]).toMatchObject({ ticketsIssued: expect.any(Number), quantity: expect.any(Number) });
    expect(txs.body[0].ticketTypes).toMatch(/×/);
  });

  it('updates the merchant contact details but not the name or status', async () => {
    const org = await ctx.login(ORG);
    const res = await org
      .patch('/v1/organizer/merchant')
      .set(csrf)
      .send({ contactPerson: 'Sari Wulandari', phone: '081234567890', address: 'Jl. Ijen 12, Malang', businessName: 'Hacked', status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contactPerson: 'Sari Wulandari', businessName: 'Arunika Live Entertainment', status: 'APPROVED' });
    const integ = await org.get('/v1/organizer/integration');
    expect(integ.body).toMatchObject({ webhookConfigured: true, activeApiKeys: expect.any(Number) });
  });
});

describe('reconciliation', () => {
  it('matches clean payments and flags each kind of disagreement', async () => {
    const org = await ctx.login(ORG);
    const ev = await createEvent(org, { title: 'Reconciliation Night' });
    const withTier = await org.post(`/v1/organizer/events/${ev.id}/tiers`).set(csrf).send(tierBody({ quota: 40 }));
    await org.post(`/v1/organizer/events/${ev.id}/publish`).set(csrf);
    const tierId = withTier.body.tiers[0].id;
    const clean = await buy(ev.slug, tierId);
    const noLedger = await buy(ev.slug, tierId);
    const lostTicket = await buy(ev.slug, tierId, 2);
    const providerAhead = await buy(ev.slug, tierId);

    await ctx.db.delete(ledgerEntries).where(eq(ledgerEntries.paymentId, noLedger.paymentId));
    const [one] = await ctx.db.select().from(tickets).where(eq(tickets.paymentId, lostTicket.paymentId)).limit(1);
    await ctx.db.update(tickets).set({ status: 'CANCELLED' }).where(eq(tickets.id, one.id));
    const { payments } = await import('@ticketpay/database');
    await ctx.db.update(payments).set({ status: 'PENDING' }).where(eq(payments.id, providerAhead.paymentId));

    const rec = await org.get('/v1/organizer/reconciliation');
    const byId = (id: string) => rec.body.rows.find((r: { paymentId: string }) => r.paymentId === id);
    expect(byId(clean.paymentId)).toMatchObject({ status: 'MATCHED', findings: [] });
    expect(byId(noLedger.paymentId).status).toBe('MISMATCH');
    expect(byId(noLedger.paymentId).findings.join()).toContain('no ledger entries');
    expect(byId(lostTicket.paymentId).findings.join()).toContain('1 of 2 tickets');
    expect(byId(providerAhead.paymentId).findings.join()).toContain('provider reports "settlement"');
    expect(rec.body.summary.MISMATCH).toBeGreaterThanOrEqual(3);
    await ctx.db.update(payments).set({ status: 'PAID' }).where(eq(payments.id, providerAhead.paymentId));
  });
});
