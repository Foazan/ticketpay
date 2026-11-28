// QR issuance and gate validation. Test matrix T15 to T19 and T22, plus event, permission and status checks.
import { auditLogs, events, orders, ticketQrTokens, ticketRedemptions, ticketTiers, tickets } from '@ticketpay/database';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { PaymentsService } from '../src/payments/payments.service';
import { bootTestApp, csrf, type TestContext } from './helpers';

let ctx: TestContext;
let soundwaveId: string;
let indieId: string;
let regularTier: string;

const BUYER = 'buyer@ticketpay.example';
const BUYER2 = 'buyer2@ticketpay.example';
const GATE = 'gate@ticketpay.example'; // assigned to Soundwave and Indie Music Night
const GATE2 = 'gate2@ticketpay.example'; // assigned to Soundwave only

type Agent = Awaited<ReturnType<TestContext['login']>>;

/** Buys and pays for `quantity` Soundwave tickets as `email`, returns the issued ticket rows. */
async function buyTickets(email: string, quantity = 1) {
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, email), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
  const agent = await ctx.login(email);
  const order = await agent
    .post('/v1/orders')
    .set(csrf)
    .send({ eventSlug: 'soundwave-festival-2026', items: [{ tierId: regularTier, quantity }], checkoutKey: randomUUID(), buyerName: 'Buyer', buyerEmail: email });
  expect(order.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'VA' });
  expect((await agent.post(`/v1/dev/mock-payments/${payment.body.id}/simulate`).set(csrf).send({ outcome: 'paid' })).status).toBe(200);
  const rows = await ctx.db.select().from(tickets).where(eq(tickets.paymentId, payment.body.id)).orderBy(tickets.seq);
  expect(rows).toHaveLength(quantity);
  return { agent, tickets: rows, paymentId: payment.body.id as string };
}

const qrFor = async (agent: Agent, ticketId: string) => {
  const res = await agent.get(`/v1/tickets/${ticketId}/qr`);
  expect(res.status).toBe(200);
  return res.body.qr as string;
};

/** Soundwave requires a photo ID check, so redeem confirms it unless a test says otherwise. */
const check = (gate: Agent, action: 'validate' | 'redeem', body: Record<string, unknown>) =>
  gate.post(`/v1/gate/${action}`).set(csrf).send(action === 'redeem' ? { idChecked: true, ...body } : body);

beforeAll(async () => {
  ctx = await bootTestApp();
  const all = await ctx.db.select({ id: events.id, slug: events.slug }).from(events);
  soundwaveId = all.find((e) => e.slug === 'soundwave-festival-2026')!.id;
  indieId = all.find((e) => e.slug === 'indie-music-night')!.id;
  const [tier] = await ctx.db
    .select({ id: ticketTiers.id })
    .from(ticketTiers)
    .where(and(eq(ticketTiers.eventId, soundwaveId), eq(ticketTiers.name, 'Regular')));
  regularTier = tier.id;
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('QR issuance', () => {
  it('gives the owner an opaque, short-lived QR that reveals no ids or personal data', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const res = await agent.get(`/v1/tickets/${t.id}/qr`);
    expect(res.status).toBe(200);
    expect(res.body.qr).toMatch(/^TP1\.[A-Za-z0-9_-]{32}$/);
    expect(res.body.refreshInSeconds).toBe(30);
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(80_000);
    expect(ttl).toBeLessThanOrEqual(90_000);
    for (const secret of [t.id, t.validationCode, t.ownerId, 'Rania', 'buyer@']) expect(res.body.qr).not.toContain(secret);
    // Only the hash is stored.
    const stored = await ctx.db.select().from(ticketQrTokens).where(eq(ticketQrTokens.ticketId, t.id));
    expect(stored[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(res.body.qr.slice(4));
    // Every request gives a new code.
    expect(await qrFor(agent, t.id)).not.toBe(res.body.qr);
  });

  it('T18: another buyer cannot get a QR for, or even see, someone else’s ticket', async () => {
    const { tickets: [t] } = await buyTickets(BUYER);
    const other = await ctx.login(BUYER2);
    expect((await other.get(`/v1/tickets/${t.id}/qr`)).status).toBe(404);
    expect((await other.get(`/v1/tickets/${t.id}`)).status).toBe(404);
  });
});

describe('Gate validation', () => {
  it('T15: a valid QR is accepted, then admitted once', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const qr = await qrFor(agent, t.id);

    const v = await check(gate, 'validate', { eventId: soundwaveId, qr });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ outcome: 'VALID', ok: true, method: 'QR', chainOwner: 'SKIPPED', ticket: { id: t.id, tierName: 'Regular', eventTitle: 'Soundwave Festival 2026' } });
    expect(v.body.ticket.holderName).toBeTruthy();
    // Gate staff see what they need to admit someone, not contact or payment data.
    expect(JSON.stringify(v.body)).not.toMatch(/@|paymentRef|validationCode|phone/i);
    // Validating admits no one.
    expect((await ctx.db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe('ACTIVE');

    const r = await check(gate, 'redeem', { eventId: soundwaveId, qr });
    expect(r.body).toMatchObject({ outcome: 'ADMITTED', ok: true, method: 'QR', redeemedBy: 'Gate Staff Satu' });
    const [after] = await ctx.db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(after.status).toBe('REDEEMED');
    const [redemption] = await ctx.db.select().from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, t.id));
    expect(redemption).toMatchObject({ eventId: soundwaveId, method: 'QR', chainStatus: 'PENDING' });
    const [token] = await ctx.db.select().from(ticketQrTokens).where(eq(ticketQrTokens.id, redemption.qrTokenId!));
    expect(token.usedAt).not.toBeNull();
    const audit = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'ticket.redeemed'), eq(auditLogs.entityId, t.id)));
    expect(audit).toHaveLength(1);

    // The buyer's ticket now shows as used, without a QR or manual code.
    const detail = await agent.get(`/v1/tickets/${t.id}`);
    expect(detail.body).toMatchObject({ status: 'REDEEMED', validationCode: null, chain: { redeemStatus: 'OFF_CHAIN' } });
    expect((await agent.get(`/v1/tickets/${t.id}/qr`)).status).toBe(403);
  });

  it('T16: invalid, forged, malformed and expired QR codes are rejected', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    for (const qr of ['hello', 'TP1.short', `TP1.${'A'.repeat(32)}`, t.id, `https://ticketpay.example/t/${t.id}`]) {
      const res = await check(gate, 'validate', { eventId: soundwaveId, qr });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: 'INVALID', ok: false });
      expect(res.body.ticket).toBeUndefined();
    }
    expect((await check(gate, 'redeem', { eventId: soundwaveId, code: 'TP-0000-0000' })).body.outcome).toBe('INVALID');

    const qr = await qrFor(agent, t.id);
    await ctx.db.update(ticketQrTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(ticketQrTokens.ticketId, t.id));
    expect((await check(gate, 'validate', { eventId: soundwaveId, qr })).body.outcome).toBe('EXPIRED');
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr })).body.outcome).toBe('EXPIRED');
    expect((await ctx.db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe('ACTIVE');
    // A request must carry exactly one of qr or code.
    expect((await check(gate, 'validate', { eventId: soundwaveId })).status).toBe(400);
    expect((await check(gate, 'validate', { eventId: soundwaveId, qr, code: t.validationCode })).status).toBe(400);
  });

  it('T17: an already redeemed ticket is rejected, by QR, by a new QR or by manual code', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const gate2 = await ctx.login(GATE2);
    const qr = await qrFor(agent, t.id);
    const spare = await qrFor(agent, t.id); // issued before admission, e.g. a screenshot
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr })).body.outcome).toBe('ADMITTED');

    for (const [who, body] of [
      [gate, { eventId: soundwaveId, qr }],
      [gate2, { eventId: soundwaveId, qr: spare }],
      [gate2, { eventId: soundwaveId, code: t.validationCode }],
    ] as const) {
      for (const action of ['validate', 'redeem'] as const) {
        const res = await check(who, action, body);
        expect(res.body).toMatchObject({ outcome: 'ALREADY_REDEEMED', ok: false, redeemedBy: 'Gate Staff Satu' });
        expect(res.body.redeemedAt).toBeTruthy();
      }
    }
    expect(await ctx.db.select().from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, t.id))).toHaveLength(1);
  });

  it('T18: a QR issued to a previous holder fails the ownership check', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const qr = await qrFor(agent, t.id);
    // The ticket changes hands (a future official resale flow): QR codes issued to the old holder stop working.
    await ctx.db.update(tickets).set({ ownerId: ctx.ids.buyer2 }).where(eq(tickets.id, t.id));
    for (const action of ['validate', 'redeem'] as const) {
      const res = await check(gate, action, { eventId: soundwaveId, qr });
      expect(res.body).toMatchObject({ outcome: 'OWNERSHIP_MISMATCH', ok: false });
      expect(res.body.ticket).toBeUndefined();
    }
    expect((await agent.get(`/v1/tickets/${t.id}/qr`)).status).toBe(404);
    const newOwner = await ctx.login(BUYER2);
    const fresh = await qrFor(newOwner, t.id);
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr: fresh })).body.outcome).toBe('ADMITTED');
  });

  it('T19: of simultaneous redemption requests, exactly one succeeds', async () => {
    const { agent, tickets: [a, b] } = await buyTickets(BUYER, 2);
    const gate = await ctx.login(GATE);
    const gate2 = await ctx.login(GATE2);

    // Same QR at two gates, five times each.
    const qr = await qrFor(agent, a.id);
    const same = await Promise.all(Array.from({ length: 10 }, (_, i) => check(i % 2 ? gate : gate2, 'redeem', { eventId: soundwaveId, qr })));
    expect(same.filter((r) => r.body.outcome === 'ADMITTED')).toHaveLength(1);
    expect(same.filter((r) => r.body.outcome === 'ALREADY_REDEEMED')).toHaveLength(9);

    // Different QR codes and the manual code for one ticket, all at once.
    const qrs = await Promise.all([qrFor(agent, b.id), qrFor(agent, b.id), qrFor(agent, b.id)]);
    const mixed = await Promise.all([
      ...qrs.map((q, i) => check(i % 2 ? gate : gate2, 'redeem', { eventId: soundwaveId, qr: q })),
      check(gate, 'redeem', { eventId: soundwaveId, code: b.validationCode }),
    ]);
    expect(mixed.filter((r) => r.body.outcome === 'ADMITTED')).toHaveLength(1);
    for (const id of [a.id, b.id]) expect(await ctx.db.select().from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, id))).toHaveLength(1);
  });

  it('enforces the photo ID check the organizer asked for, consuming nothing until staff confirm it', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const qr = await qrFor(agent, t.id);
    expect((await check(gate, 'validate', { eventId: soundwaveId, qr })).body).toMatchObject({ outcome: 'VALID', requiresIdCheck: true });

    for (const idChecked of [undefined, false]) {
      const refused = await check(gate, 'redeem', { eventId: soundwaveId, qr, idChecked });
      expect(refused.body).toMatchObject({ outcome: 'ID_CHECK_REQUIRED', ok: false, requiresIdCheck: true, ticket: { id: t.id } });
      expect(refused.body.ticket.holderName).toBeTruthy();
    }
    // Nothing was used up: the same QR still admits once the ID is confirmed.
    expect((await ctx.db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe('ACTIVE');
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr, idChecked: true, idCheckMethod: 'FACE_SCAN' })).status).toBe(400);
    const admitted = await check(gate, 'redeem', { eventId: soundwaveId, qr, idChecked: true, idCheckMethod: 'OCR_MATCH' });
    expect(admitted.body).toMatchObject({ outcome: 'ADMITTED', requiresIdCheck: true, idChecked: true });
    const [audit] = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'ticket.redeemed'), eq(auditLogs.entityId, t.id)));
    // How the ID was checked is recorded; nothing from the card itself ever reaches the server.
    expect(audit.metadata).toMatchObject({ idCheckRequired: true, idChecked: true, idCheckMethod: 'OCR_MATCH' });
  });

  it('does not ask for an ID at events that do not require one', async () => {
    await ctx.db.update(events).set({ requiresIdCheck: false }).where(eq(events.id, soundwaveId));
    try {
      const { agent, tickets: [t] } = await buyTickets(BUYER);
      const gate = await ctx.login(GATE);
      const qr = await qrFor(agent, t.id);
      expect((await check(gate, 'validate', { eventId: soundwaveId, qr })).body).toMatchObject({ outcome: 'VALID', requiresIdCheck: false });
      const res = await gate.post('/v1/gate/redeem').set(csrf).send({ eventId: soundwaveId, qr });
      expect(res.body).toMatchObject({ outcome: 'ADMITTED', requiresIdCheck: false, idChecked: false });
    } finally {
      await ctx.db.update(events).set({ requiresIdCheck: true }).where(eq(events.id, soundwaveId));
    }
  });

  it('accepts the manual code however it is typed', async () => {
    const { tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const typed = ` ${t.validationCode.toLowerCase().replace(/-/g, ' ')} `;
    expect((await check(gate, 'validate', { eventId: soundwaveId, code: typed })).body).toMatchObject({ outcome: 'VALID', method: 'MANUAL_CODE' });
    // A scanner reading a printed code sends it as `qr`; it is treated as a code.
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr: t.validationCode })).body).toMatchObject({ outcome: 'ADMITTED', method: 'MANUAL_CODE' });
  });

  it('rejects a ticket for another event without revealing its holder', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const res = await check(gate, 'redeem', { eventId: indieId, qr: await qrFor(agent, t.id) });
    expect(res.body).toMatchObject({ outcome: 'WRONG_EVENT', ok: false });
    expect(res.body.ticket).toBeUndefined();
    expect((await ctx.db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe('ACTIVE');
  });

  it('rejects cancelled, refunded and unpaid tickets', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const qr = await qrFor(agent, t.id);
    await ctx.db.update(tickets).set({ status: 'CANCELLED' }).where(eq(tickets.id, t.id));
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr })).body.outcome).toBe('CANCELLED');
    await ctx.db.update(tickets).set({ status: 'ACTIVE' }).where(eq(tickets.id, t.id));
    await ctx.db.update(orders).set({ status: 'REFUNDED' }).where(eq(orders.id, t.orderId));
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr })).body.outcome).toBe('CANCELLED');
    await ctx.db.update(orders).set({ status: 'PENDING' }).where(eq(orders.id, t.orderId));
    expect((await check(gate, 'redeem', { eventId: soundwaveId, qr })).body.outcome).toBe('NOT_PAID');
    expect(await ctx.db.select().from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, t.id))).toHaveLength(0);
    await ctx.db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, t.orderId));
  });
});

describe('Gate access', () => {
  it('only gate staff assigned to the event can validate it', async () => {
    const { agent, tickets: [t] } = await buyTickets(BUYER);
    const qr = await qrFor(agent, t.id);
    const gate2 = await ctx.login(GATE2);
    expect((await check(gate2, 'validate', { eventId: indieId, qr })).status).toBe(403);
    expect((await check(agent, 'validate', { eventId: soundwaveId, qr })).status).toBe(403);
    expect((await (await ctx.login('organizer@ticketpay.example')).post('/v1/gate/redeem').set(csrf).send({ eventId: soundwaveId, qr })).status).toBe(403);
    expect((await ctx.db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe('ACTIVE');
  });

  it('lists assigned events with issued and admitted counts', async () => {
    const res = await (await ctx.login(GATE)).get('/v1/gate/events');
    expect(res.status).toBe(200);
    expect(res.body.map((e: { id: string }) => e.id).sort()).toEqual([indieId, soundwaveId].sort());
    const sw = res.body.find((e: { id: string }) => e.id === soundwaveId);
    expect(sw.admitted).toBeGreaterThan(0);
    expect(sw.ticketsIssued).toBeGreaterThanOrEqual(sw.admitted);
    expect(sw.requiresIdCheck).toBe(true);
    expect(res.body.find((e: { id: string }) => e.id === indieId).requiresIdCheck).toBe(false);
  });

  it('T22: gate staff cannot create, pay or read payments, orders or merchant data', async () => {
    const { paymentId, tickets: [t] } = await buyTickets(BUYER);
    const gate = await ctx.login(GATE);
    const attempts = [
      gate.post('/v1/orders').set(csrf).send({ eventSlug: 'soundwave-festival-2026', items: [{ tierId: regularTier, quantity: 1 }], checkoutKey: randomUUID(), buyerName: 'X', buyerEmail: 'x@example.com' }),
      gate.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: t.orderId, method: 'VA' }),
      gate.get(`/v1/payments/${paymentId}`),
      gate.post(`/v1/dev/mock-payments/${paymentId}/simulate`).set(csrf).send({ outcome: 'failed' }),
      gate.get('/v1/merchant/transactions'),
      gate.get('/v1/merchant/ledger'),
      gate.get('/v1/tickets'),
    ];
    for (const res of await Promise.all(attempts)) expect([401, 403, 404]).toContain(res.status);
    const [order] = await ctx.db.select().from(orders).where(eq(orders.id, t.orderId));
    expect(order.status).toBe('PAID');
  });
});
