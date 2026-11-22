// End-to-end tests against a real PostgreSQL database (ticketpay_test).
// Covers the Phase 2 access-control cases from the test matrix: T20, T21 (read side), T22, T23.
import type { INestApplication } from '@nestjs/common';
import {
  DEMO_PASSWORD,
  events,
  merchants,
  orderItems,
  orders,
  payments,
  ticketTiers,
  tickets,
  users,
  type Database,
} from '@ticketpay/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { bootTestApp, csrf, type TestContext } from './helpers';

let ctx: TestContext;
let app: INestApplication;
let db: Database;
let ids: TestContext['ids'];
let otherMerchantEventId: string;
let buyer2TicketId: string;

const loginAs = (email: string) => ctx.login(email);

beforeAll(async () => {
  ctx = await bootTestApp();
  ({ app, db, ids } = ctx);

  // An event that belongs to a different merchant than the demo organizer.
  const [nusa] = await db.select().from(merchants).where(eq(merchants.businessName, 'Nusa Konferensi'));
  const [ev] = await db.select().from(events).where(eq(events.merchantId, nusa.id)).limit(1);
  otherMerchantEventId = ev.id;

  // A paid ticket owned by buyer2, inserted directly as a fixture.
  const [tier] = await db.select().from(ticketTiers).where(eq(ticketTiers.eventId, ev.id)).limit(1);
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: 'TP-TEST-0001',
      buyerId: ids.buyer2,
      eventId: ev.id,
      merchantId: nusa.id,
      status: 'PAID',
      subtotal: tier.price,
      serviceFee: Math.round(tier.price * 0.03),
      feeRateBps: 300,
      total: tier.price + Math.round(tier.price * 0.03),
      buyerName: 'Bima Santoso',
      buyerEmail: 'buyer2@ticketpay.example',
      holdExpiresAt: new Date(Date.now() + 900_000),
      checkoutKey: 'test-checkout-1',
      isSeed: true,
    })
    .returning();
  const [item] = await db.insert(orderItems).values({ orderId: order.id, tierId: tier.id, quantity: 1, unitPrice: tier.price }).returning();
  const [payment] = await db
    .insert(payments)
    .values({
      orderId: order.id,
      merchantId: nusa.id,
      reference: 'PAY-TEST-0001',
      idempotencyKey: 'idem-test-1',
      requestHash: 'x',
      amount: order.total,
      status: 'PAID',
      provider: 'MOCK',
      method: 'VA',
      expiresAt: new Date(Date.now() + 900_000),
    })
    .returning();
  const [ticket] = await db
    .insert(tickets)
    .values({
      orderId: order.id,
      orderItemId: item.id,
      ownerId: ids.buyer2,
      eventId: ev.id,
      tierId: tier.id,
      paymentId: payment.id,
      seq: 1,
      paymentRefHash: '0xtest1',
      validationCode: 'TP-TEST-CODE',
    })
    .returning();
  buyer2TicketId = ticket.id;

});

afterAll(() => ctx.close());

describe('health', () => {
  it('reports the database and the sandbox modes', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', paymentProvider: 'mock', chainMode: 'disabled', chain: { mode: 'disabled', ready: false } });
  });
});

describe('public catalog', () => {
  const get = (qs = '') => request(app.getHttpServer()).get(`/v1/events${qs}`);

  it('lists the 12 seeded events with price and availability from the database', async () => {
    const res = await get('?pageSize=48');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    const soundwave = res.body.items.find((e: { slug: string }) => e.slug === 'soundwave-festival-2026');
    expect(soundwave).toMatchObject({ city: 'Malang', fromPrice: 150000, ticketsAvailable: 1150, organizer: 'Arunika Live Entertainment' });
  });

  it('filters by city, category, price and search text', async () => {
    expect((await get('?city=Malang')).body.total).toBe(5);
    expect((await get('?category=sports')).body.total).toBe(2);
    expect((await get('?maxPrice=50000')).body.total).toBe(3);
    expect((await get('?q=badminton')).body.items.map((e: { title: string }) => e.title)).toEqual(['National Badminton Open']);
  });

  it('sorts by price and by date', async () => {
    expect((await get('?sort=price_asc')).body.items[0].title).toBe('Campus Creative Week');
    expect((await get('?sort=date_asc')).body.items[0].title).toBe('Soundwave Festival 2026');
  });

  it('rejects an invalid query', async () => {
    expect((await get('?page=0')).status).toBe(400);
    expect((await get('?sort=nonsense')).status).toBe(400);
  });

  it('returns event detail with ticket tiers, and 404 for an unknown slug', async () => {
    const res = await request(app.getHttpServer()).get('/v1/events/soundwave-festival-2026');
    expect(res.status).toBe(200);
    expect(res.body.tiers.map((t: { name: string; price: number; available: number }) => [t.name, t.price, t.available])).toEqual([
      ['Regular', 150000, 1000],
      ['VIP', 350000, 150],
    ]);
    expect((await request(app.getHttpServer()).get('/v1/events/does-not-exist')).status).toBe(404);
  });

  it('hides events of merchants that are not approved', async () => {
    const [pending] = await db.select().from(merchants).where(eq(merchants.status, 'PENDING'));
    const [template] = await db.select().from(events).limit(1);
    await db.insert(events).values({
      merchantId: pending.id,
      categoryId: template.categoryId,
      title: 'Hidden Pending Event',
      slug: 'hidden-pending-event',
      description: 'x',
      city: 'Bandung',
      venue: 'x',
      startAt: new Date('2027-05-01T10:00:00+07:00'),
      endAt: new Date('2027-05-01T12:00:00+07:00'),
      posterPath: '/posters/x.svg',
      status: 'PUBLISHED',
    });
    expect((await get('?pageSize=48')).body.total).toBe(12);
    expect((await request(app.getHttpServer()).get('/v1/events/hidden-pending-event')).status).toBe(404);
  });
});

describe('authentication', () => {
  it('requires a session for protected routes', async () => {
    expect((await request(app.getHttpServer()).get('/v1/auth/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/v1/tickets')).status).toBe(401);
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const a = await request(app.getHttpServer()).post('/v1/auth/login').set(csrf).send({ email: 'buyer@ticketpay.example', password: 'wrong-password' });
    const b = await request(app.getHttpServer()).post('/v1/auth/login').set(csrf).send({ email: 'nobody@ticketpay.example', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'buyer@ticketpay.example', password: DEMO_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('sets an httpOnly session cookie and never returns the password hash', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/login').set(csrf).send({ email: 'buyer@ticketpay.example', password: DEMO_PASSWORD });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/tp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    expect(res.body.user).toMatchObject({ role: 'BUYER', merchant: null });
  });

  it('stores passwords as argon2id hashes', async () => {
    const [row] = await db.select().from(users).where(eq(users.email, 'buyer@ticketpay.example'));
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('registers a buyer, and refuses a duplicate email', async () => {
    const body = { email: 'new.buyer@ticketpay.example', password: 'a-long-password', fullName: 'New Buyer' };
    const first = await request(app.getHttpServer()).post('/v1/auth/register').set(csrf).send(body);
    expect(first.status).toBe(201);
    expect(first.body.user.role).toBe('BUYER');
    expect((await request(app.getHttpServer()).post('/v1/auth/register').set(csrf).send(body)).status).toBe(409);
    expect((await request(app.getHttpServer()).post('/v1/auth/register').set(csrf).send({ ...body, email: 'x@y.example', password: 'short' })).status).toBe(400);
  });

  it('registers an organizer with a merchant that waits for approval', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/register-organizer').set(csrf).send({
      email: 'new.organizer@ticketpay.example',
      password: 'a-long-password',
      fullName: 'New Organizer',
      phone: '081234567890',
      businessName: 'Panggung Baru',
      organizerType: 'Event promoter',
      contactPerson: 'New Organizer',
      address: 'Jl. Contoh 1, Malang',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'ORGANIZER', merchant: { businessName: 'Panggung Baru', status: 'PENDING' } });
  });
});

describe('role-based access control', () => {
  it('T20: a buyer cannot access the organizer, gate or admin areas', async () => {
    const buyer = await loginAs('buyer@ticketpay.example');
    expect((await buyer.get('/v1/organizer/overview')).status).toBe(403);
    expect((await buyer.get('/v1/organizer/events')).status).toBe(403);
    expect((await buyer.get('/v1/gate/events')).status).toBe(403);
    expect((await buyer.get('/v1/admin/overview')).status).toBe(403);
  });

  it("T21 (read side): an organizer sees only their own merchant's events", async () => {
    const organizer = await loginAs('organizer@ticketpay.example');
    const list = await organizer.get('/v1/organizer/events');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(5);
    expect((await organizer.get(`/v1/organizer/events/${list.body[0].id}`)).status).toBe(200);
    expect((await organizer.get(`/v1/organizer/events/${otherMerchantEventId}`)).status).toBe(404);
    const overview = await organizer.get('/v1/organizer/overview');
    expect(overview.body).toMatchObject({ totalEvents: 5, publishedEvents: 5, ticketsSold: 0, totalRevenue: 0 });
  });

  it('T22: gate staff cannot read payments or organizer data, and see only assigned events', async () => {
    const gate = await loginAs('gate@ticketpay.example');
    expect((await gate.get('/v1/admin/payments')).status).toBe(403);
    expect((await gate.get('/v1/organizer/overview')).status).toBe(403);
    expect((await gate.get('/v1/tickets')).status).toBe(403);
    const assigned = await gate.get('/v1/gate/events');
    expect(assigned.status).toBe(200);
    expect(assigned.body.map((e: { title: string }) => e.title)).toEqual(['Soundwave Festival 2026', 'Indie Music Night']);
  });

  it("T23: a buyer cannot access another buyer's ticket", async () => {
    const buyer = await loginAs('buyer@ticketpay.example');
    expect((await buyer.get(`/v1/tickets/${buyer2TicketId}`)).status).toBe(404);
    expect((await buyer.get('/v1/tickets')).body).toEqual([]);
    const buyer2 = await loginAs('buyer2@ticketpay.example');
    const own = await buyer2.get(`/v1/tickets/${buyer2TicketId}`);
    expect(own.status).toBe(200);
    expect(own.body.holderName).toBe('Bima Santoso');
  });

  it('lets an administrator read platform data', async () => {
    const admin = await loginAs('admin@ticketpay.example');
    const overview = await admin.get('/v1/admin/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.merchants.APPROVED).toBe(3);
    expect((await admin.get('/v1/admin/payments')).body).toHaveLength(1);
  });

  it('ends the session on logout', async () => {
    const buyer = await loginAs('buyer@ticketpay.example');
    expect((await buyer.get('/v1/auth/me')).status).toBe(200);
    await buyer.post('/v1/auth/logout').set(csrf);
    expect((await buyer.get('/v1/auth/me')).status).toBe(401);
  });

  it('rate limits repeated login attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(app.getHttpServer()).post('/v1/auth/login').set(csrf).send({ email: 'buyer@ticketpay.example', password: 'wrong-password' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
