// Editing one's own account: name and phone, password change that signs out other sessions,
// and the gate warning when a ticket holder renamed their account after buying.
import { auditLogs, events, orders, ticketTiers, tickets, users } from '@ticketpay/database';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PaymentsService } from '../src/payments/payments.service';
import { bootTestApp, csrf, type TestContext } from './helpers';

let ctx: TestContext;
const PASSWORD = 'AkunUji12345';
let soundwaveId: string;
let regularTier: string;

type Agent = ReturnType<typeof request.agent>;

async function newBuyer(fullName = 'Rizky Pratama'): Promise<{ agent: Agent; email: string; id: string }> {
  const agent = request.agent(ctx.app.getHttpServer());
  const email = `akun.${randomUUID().slice(0, 8)}@ticketpay.example`;
  const res = await agent.post('/v1/auth/register').set(csrf).send({ email, password: PASSWORD, fullName });
  expect(res.status).toBe(201);
  return { agent, email, id: res.body.user.id };
}

async function buyOne(agent: Agent, email: string) {
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, email), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
  const order = await agent
    .post('/v1/orders')
    .set(csrf)
    .send({ eventSlug: 'soundwave-festival-2026', items: [{ tierId: regularTier, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'Buyer', buyerEmail: email });
  expect(order.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'VA' });
  await agent.post(`/v1/dev/mock-payments/${payment.body.id}/simulate`).set(csrf).send({ outcome: 'paid' });
  const [t] = await ctx.db.select().from(tickets).where(eq(tickets.paymentId, payment.body.id));
  return t;
}

beforeAll(async () => {
  ctx = await bootTestApp();
  const [ev] = await ctx.db.select().from(events).where(eq(events.slug, 'soundwave-festival-2026'));
  soundwaveId = ev.id;
  const [tier] = await ctx.db.select().from(ticketTiers).where(and(eq(ticketTiers.eventId, ev.id), eq(ticketTiers.name, 'Regular')));
  regularTier = tier.id;
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('own profile', () => {
  it('requires a session, and every role can read its own account', async () => {
    expect((await ctx.http().get('/v1/account')).status).toBe(401);
    expect((await ctx.http().patch('/v1/account').set(csrf).send({ fullName: 'Someone' })).status).toBe(401);
    for (const email of ['organizer@ticketpay.example', 'gate@ticketpay.example', 'admin@ticketpay.example']) {
      const res = await (await ctx.login(email)).get('/v1/account');
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(email);
      expect(JSON.stringify(res.body)).not.toMatch(/password|sessionVersion|custodial/i);
    }
  });

  it('changes the name and phone, validates them, and audits a name change', async () => {
    const { agent, id } = await newBuyer();
    expect((await agent.patch('/v1/account').set(csrf).send({ fullName: 'A' })).status).toBe(400);
    expect((await agent.patch('/v1/account').set(csrf).send({ fullName: 'Rizky Pratama', phone: 'not a phone' })).status).toBe(400);
    expect((await agent.patch('/v1/account').send({ fullName: 'Rizky' })).status).toBe(403); // CSRF header

    const res = await agent.patch('/v1/account').set(csrf).send({ fullName: '  Muhammad Rizky Pratama ', phone: '0812 3456 7890' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'Muhammad Rizky Pratama', phone: '0812 3456 7890' });
    expect(res.body.nameChangedAt).not.toBeNull();
    expect((await agent.get('/v1/auth/me')).body.user.fullName).toBe('Muhammad Rizky Pratama');
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'user.profile_updated'), eq(auditLogs.entityId, id)));
    expect(audit.metadata).toMatchObject({ changed: ['fullName', 'phone'], nameFrom: 'Rizky Pratama', nameTo: 'Muhammad Rizky Pratama' });

    // Same values: nothing changes and nothing is audited.
    const before = res.body.nameChangedAt;
    const same = await agent.patch('/v1/account').set(csrf).send({ fullName: 'Muhammad Rizky Pratama', phone: '0812 3456 7890' });
    expect(same.body.nameChangedAt).toBe(before);
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'user.profile_updated'), eq(auditLogs.entityId, id)))).toHaveLength(1);

    // An empty phone removes it, and the name stays.
    const cleared = await agent.patch('/v1/account').set(csrf).send({ fullName: 'Muhammad Rizky Pratama', phone: '' });
    expect(cleared.body).toMatchObject({ phone: null, nameChangedAt: before });
  });
});

describe('password change', () => {
  it('needs the current password, then signs out every other session', async () => {
    const { agent, email, id } = await newBuyer();
    const other = request.agent(ctx.app.getHttpServer());
    expect((await other.post('/v1/auth/login').set(csrf).send({ email, password: PASSWORD })).status).toBe(200);

    expect((await agent.post('/v1/account/password').set(csrf).send({ currentPassword: 'wrong-password', newPassword: 'BaruSekali123' })).status).toBe(400);
    expect((await agent.post('/v1/account/password').set(csrf).send({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await agent.post('/v1/account/password').set(csrf).send({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);

    const ok = await agent.post('/v1/account/password').set(csrf).send({ currentPassword: PASSWORD, newPassword: 'BaruSekali123' });
    expect(ok.status).toBe(200);
    // This browser keeps working with its fresh cookie; the other one is signed out.
    expect((await agent.get('/v1/auth/me')).status).toBe(200);
    expect((await other.get('/v1/auth/me')).status).toBe(401);

    expect((await ctx.http().post('/v1/auth/login').set(csrf).send({ email, password: PASSWORD })).status).toBe(401);
    expect((await ctx.http().post('/v1/auth/login').set(csrf).send({ email, password: 'BaruSekali123' })).status).toBe(200);
    const [u] = await ctx.db.select({ v: users.sessionVersion }).from(users).where(eq(users.id, id));
    expect(u.v).toBe(1);
    expect(await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'user.password_changed'), eq(auditLogs.entityId, id)))).toHaveLength(1);
  });
});

describe('gate warning after a rename', () => {
  it('flags a ticket whose holder renamed their account after buying it, but not one bought afterwards', async () => {
    const { agent, email } = await newBuyer('Dewi Anggraini');
    const before = await buyOne(agent, email);
    await agent.patch('/v1/account').set(csrf).send({ fullName: 'Dewi Lestari' });
    const after = await buyOne(agent, email);

    const gate = await ctx.login('gate@ticketpay.example');
    const qr = async (ticketId: string) => (await agent.get(`/v1/tickets/${ticketId}/qr`)).body.qr as string;
    const flagged = await gate.post('/v1/gate/validate').set(csrf).send({ eventId: soundwaveId, qr: await qr(before.id) });
    expect(flagged.body).toMatchObject({ outcome: 'VALID', ticket: { holderName: 'Dewi Lestari' } });
    expect(flagged.body.holderNameChangedAt).toBeTruthy();

    const fresh = await gate.post('/v1/gate/validate').set(csrf).send({ eventId: soundwaveId, qr: await qr(after.id) });
    expect(fresh.body.outcome).toBe('VALID');
    expect(fresh.body.holderNameChangedAt).toBeUndefined();
  });
});
