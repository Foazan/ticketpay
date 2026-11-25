// Minting end-to-end against a real (local Hardhat) chain.
// Covers: mint only after verified payment, no mint for unpaid or failed payments, one token per ticket
// under repeated notifications, crash recovery from contract state, custodial ownership and the ticket API.
import { blockchainTransactions, events, orders, ticketRedemptions, ticketTiers, tickets, users } from '@ticketpay/database';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ChainClient } from '../src/chain/chain.client';
import { MintService } from '../src/chain/mint.service';
import { CancelService } from '../src/chain/cancel.service';
import { RedeemService } from '../src/chain/redeem.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { PaymentsService } from '../src/payments/payments.service';
import { Wallet } from 'ethers';
import { HARDHAT_KEYS, startChainNode, type ChainNode } from './chain-node';
import { bootTestApp, csrf, waitFor, type TestContext } from './helpers';

let ctx: TestContext;
let node: ChainNode;
let regular: { id: string; eventId: string };
const GATE = 'gate@ticketpay.example';

const SLUG = 'soundwave-festival-2026';
const BUYER = 'buyer@ticketpay.example';

async function checkout(email: string, quantity: number) {
  await ctx.db.update(orders).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(and(eq(orders.buyerEmail, email), eq(orders.status, 'PENDING')));
  await ctx.app.get(PaymentsService).expireStale();
  const agent = await ctx.login(email);
  const order = await agent
    .post('/v1/orders')
    .set(csrf)
    .send({ eventSlug: SLUG, items: [{ tierId: regular.id, quantity }], checkoutKey: randomUUID(), buyerName: 'Rania Putri', buyerEmail: email });
  expect(order.status).toBe(201);
  const payment = await agent.post('/v1/payments').set(csrf).set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, method: 'VA' });
  expect(payment.status).toBe(201);
  return { agent, order: order.body, payment: payment.body };
}

const simulate = async (email: string, paymentId: string, outcome: 'paid' | 'failed') =>
  (await ctx.login(email)).post(`/v1/dev/mock-payments/${paymentId}/simulate`).set(csrf).send({ outcome });

const ticketsOf = (paymentId: string) => ctx.db.select().from(tickets).where(eq(tickets.paymentId, paymentId)).orderBy(tickets.seq);
const totalMinted = async () => (await node.contract.getFunction('totalMinted')()) as bigint;

async function waitMinted(paymentId: string, count: number) {
  return waitFor(
    async () => {
      const rows = await ticketsOf(paymentId);
      return rows.length === count && rows.every((t) => t.mintStatus === 'MINTED') ? rows : null;
    },
    20_000,
    `${count} minted tickets for ${paymentId}`,
  );
}

beforeAll(async () => {
  node = await startChainNode();
  ctx = await bootTestApp({
    CHAIN_MODE: 'local',
    LOCAL_RPC_URL: node.rpcUrl,
    TICKET_CONTRACT_ADDRESS: node.address,
    SIGNER_PRIVATE_KEY: '',
    CUSTODIAL_MASTER_SECRET: 'c'.repeat(64),
    MINT_RETRY_BASE_MS: '50',
    MINT_MAX_ATTEMPTS: '3',
  });
  const [row] = await ctx.db
    .select({ id: ticketTiers.id, eventId: ticketTiers.eventId })
    .from(ticketTiers)
    .innerJoin(events, eq(ticketTiers.eventId, events.id))
    .where(and(eq(events.slug, SLUG), eq(ticketTiers.name, 'Regular')));
  regular = row;
}, 120_000);

afterAll(async () => {
  await ctx?.close();
  await node?.stop();
});

describe('Chain (local Hardhat)', () => {
  it('reports a ready chain in the health check', async () => {
    const res = await ctx.app.get(ChainClient).status();
    expect(res).toMatchObject({ ready: true, chainId: 31337, contractAddress: node.address, network: 'Local Hardhat chain' });
  });

  it('mints one token per ticket after a verified payment, owned by the buyer custodial address', async () => {
    const before = await totalMinted();
    const { payment } = await checkout(BUYER, 2);
    // Paid but not yet verified: nothing exists to mint.
    expect(await ticketsOf(payment.id)).toHaveLength(0);
    expect((await simulate(BUYER, payment.id, 'paid')).status).toBe(200);

    const minted = await waitMinted(payment.id, 2);
    expect(await totalMinted()).toBe(before + 2n);

    const [buyer] = await ctx.db.select().from(users).where(eq(users.email, BUYER));
    expect(buyer.custodialAddress).toBe(ctx.app.get(ChainClient).custodialAddress(buyer.id));
    for (const t of minted) {
      const info = await node.contract.getFunction('ticketInfo')(BigInt(t.tokenId!));
      expect(info.owner).toBe(buyer.custodialAddress);
      expect(info.status).toBe(1n); // Valid
      expect(info.paymentRef).toBe(t.paymentRefHash);
      expect(Number(info.eventId)).toBeGreaterThan(0);
    }
    expect(new Set(minted.map((t) => t.tokenId)).size).toBe(2);

    // The contract supply equals the sum of the event's tier quotas.
    const [{ total }] = await ctx.db.select({ total: sql<number>`sum(${ticketTiers.quota})::int` }).from(ticketTiers).where(eq(ticketTiers.eventId, regular.eventId));
    const info = await node.contract.getFunction('ticketInfo')(BigInt(minted[0].tokenId!));
    expect(await node.contract.getFunction('maxSupply')(info.eventId)).toBe(BigInt(total));

    const txs = await ctx.db.select().from(blockchainTransactions).where(and(eq(blockchainTransactions.type, 'MINT'), eq(blockchainTransactions.status, 'CONFIRMED')));
    for (const t of minted) expect(txs.find((x) => x.ticketId === t.id)?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('shows the on-chain record in the buyer ticket API, without any key material', async () => {
    const agent = await ctx.login(BUYER);
    const list = await agent.get('/v1/tickets');
    expect(list.status).toBe(200);
    const minted = list.body.find((t: { mintStatus: string }) => t.mintStatus === 'MINTED');
    expect(minted.chain).toMatchObject({ enabled: true, network: 'Local Hardhat chain', chainId: 31337, contractAddress: node.address });
    expect(minted.chain.txHash).toMatch(/^0x/);
    expect(minted.chain.txUrl).toBeNull(); // no public explorer for a local chain

    const detail = await agent.get(`/v1/tickets/${minted.id}`);
    expect(detail.body.chain.ownerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(detail.body.paymentRefHash).toMatch(/^0x/);
    const raw = JSON.stringify([list.body, detail.body]).toLowerCase();
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  });

  it('repeated PAID notifications never mint twice', async () => {
    const before = await totalMinted();
    const { payment } = await checkout(BUYER, 1);
    await Promise.all([simulate(BUYER, payment.id, 'paid'), simulate(BUYER, payment.id, 'paid'), simulate(BUYER, payment.id, 'paid')]);
    await waitMinted(payment.id, 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await totalMinted()).toBe(before + 1n);
  });

  it('never mints for a failed or unpaid payment', async () => {
    const before = await totalMinted();
    const failed = await checkout(BUYER, 1);
    await simulate(BUYER, failed.payment.id, 'failed');
    await checkout('buyer2@ticketpay.example', 1); // left unpaid
    await new Promise((r) => setTimeout(r, 800));
    expect(await ticketsOf(failed.payment.id)).toHaveLength(0);
    expect(await totalMinted()).toBe(before);
  });

  it('recovers from a crash after sending: the token is found on-chain, not minted again', async () => {
    const { payment } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);
    const before = await totalMinted();
    // Simulate a process that lost the result: the database forgets the token.
    await ctx.db.update(tickets).set({ mintStatus: 'PENDING', tokenId: null }).where(eq(tickets.id, t.id));
    await ctx.db.update(blockchainTransactions).set({ status: 'SUBMITTED' }).where(eq(blockchainTransactions.ticketId, t.id));

    const mints = ctx.app.get(MintService);
    expect(await mints.processMint(t.id)).toBe('recovered');
    const [after] = await ticketsOf(payment.id);
    expect(after).toMatchObject({ mintStatus: 'MINTED', tokenId: t.tokenId });
    expect(await totalMinted()).toBe(before);
    expect(await mints.processMint(t.id)).toBe('already-minted');
  });

  it('does not mint a ticket that was cancelled before it reached the chain', async () => {
    const { payment } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);
    await ctx.db.update(tickets).set({ status: 'CANCELLED', mintStatus: 'PENDING', tokenId: null }).where(eq(tickets.id, t.id));
    expect(await ctx.app.get(MintService).processMint(t.id)).toBe('skipped');
    await ctx.db.update(tickets).set({ status: 'ACTIVE', mintStatus: 'MINTED', tokenId: t.tokenId }).where(eq(tickets.id, t.id));
  });

  const admit = async (agent: Awaited<ReturnType<TestContext['login']>>, ticketId: string, action: 'validate' | 'redeem' = 'redeem') => {
    const qr = (await agent.get(`/v1/tickets/${ticketId}/qr`)).body.qr;
    return (await ctx.login(GATE)).post(`/v1/gate/${action}`).set(csrf).send({ eventId: regular.eventId, qr });
  };
  const redemptionOf = async (ticketId: string) => (await ctx.db.select().from(ticketRedemptions).where(eq(ticketRedemptions.ticketId, ticketId)))[0];
  const onChainStatus = async (tokenId: string) => Number(await node.contract.getFunction('ticketStatus')(BigInt(tokenId)));

  it('admits at the gate, then redeems the NFT on-chain and records the transaction', async () => {
    const { payment, agent } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);

    const v = await admit(agent, t.id, 'validate');
    expect(v.body).toMatchObject({ outcome: 'VALID', chainOwner: 'MATCH', ticket: { tokenId: t.tokenId } });
    expect((await admit(agent, t.id)).body.outcome).toBe('ADMITTED');

    await waitFor(async () => ((await redemptionOf(t.id))?.chainStatus === 'CONFIRMED' ? true : null), 20_000, 'on-chain redeem');
    expect(await onChainStatus(t.tokenId!)).toBe(2); // Redeemed
    const [tx] = await ctx.db.select().from(blockchainTransactions).where(and(eq(blockchainTransactions.ticketId, t.id), eq(blockchainTransactions.type, 'REDEEM')));
    expect(tx).toMatchObject({ status: 'CONFIRMED' });
    expect(tx.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const detail = await agent.get(`/v1/tickets/${t.id}`);
    expect(detail.body.chain).toMatchObject({ redeemStatus: 'CONFIRMED', redeemTxHash: tx.txHash });
    // Repeating is a no-op.
    expect(await ctx.app.get(RedeemService).processRedeem(t.id)).toBe('already-confirmed');
  });

  it('an admission before the mint lands waits for the mint, then redeems', async () => {
    const { payment, agent } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);
    // Make the database believe the mint has not happened yet.
    await ctx.db.update(tickets).set({ mintStatus: 'PENDING', tokenId: null }).where(eq(tickets.id, t.id));
    expect((await admit(agent, t.id)).body.outcome).toBe('ADMITTED');
    await waitFor(async () => ((await redemptionOf(t.id))?.chainStatus === 'CONFIRMED' ? true : null), 25_000, 'redeem after mint');
    const [after] = await ticketsOf(payment.id);
    expect(after).toMatchObject({ mintStatus: 'MINTED', tokenId: t.tokenId, status: 'REDEEMED' });
    expect(await onChainStatus(t.tokenId!)).toBe(2);
  });

  it('recovers a redeem that reached the chain but was never recorded', async () => {
    const { payment, agent } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);
    await admit(agent, t.id);
    await waitFor(async () => ((await redemptionOf(t.id))?.chainStatus === 'CONFIRMED' ? true : null), 20_000, 'on-chain redeem');
    await ctx.db.update(ticketRedemptions).set({ chainStatus: 'PENDING' }).where(eq(ticketRedemptions.ticketId, t.id));
    await ctx.db.update(blockchainTransactions).set({ status: 'FAILED' }).where(and(eq(blockchainTransactions.ticketId, t.id), eq(blockchainTransactions.type, 'REDEEM')));
    expect(await ctx.app.get(RedeemService).processRedeem(t.id)).toBe('recovered');
    expect((await redemptionOf(t.id)).chainStatus).toBe('CONFIRMED');
  });

  const refund = async (paymentId: string) =>
    (await ctx.login('admin@ticketpay.example')).post(`/v1/payments/${paymentId}/refund`).set(csrf).send({ reason: 'Event date clash for the buyer' });
  const cancelTx = async (ticketId: string, status: string) =>
    (await ctx.db.select().from(blockchainTransactions).where(and(eq(blockchainTransactions.ticketId, ticketId), eq(blockchainTransactions.type, 'CANCEL'), eq(blockchainTransactions.status, status as 'FAILED'))))[0];

  it('a simulated refund cancels the minted NFTs on-chain', async () => {
    const { payment } = await checkout(BUYER, 2);
    await simulate(BUYER, payment.id, 'paid');
    const minted = await waitMinted(payment.id, 2);
    expect((await refund(payment.id)).body).toMatchObject({ status: 'REFUNDED', alreadyRefunded: false });
    for (const t of minted) {
      const tx = await waitFor(() => cancelTx(t.id, 'CONFIRMED'), 20_000, 'on-chain cancel');
      expect(tx.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(await onChainStatus(t.tokenId!)).toBe(3); // Cancelled
    }
    // Repeating finds the token already cancelled.
    expect(await ctx.app.get(CancelService).processCancel(minted[0].id)).toBe('already-confirmed');
    expect(await ctx.app.get(CancelService).cancelsToSweep(new Date(Date.now() + 11 * 60_000))).not.toContain(minted[0].id);
    const recon = await ctx.app.get(ReconciliationService).report({ limit: 500 });
    expect(recon.rows.find((r) => r.paymentId === payment.id)?.status).toBe('MATCHED');
  });

  it('without the admin role the cancel is recorded as failed with the fix, and an admin retry completes it', async () => {
    const signer = new Wallet(HARDHAT_KEYS.signer).address;
    const role = await node.contract.getFunction('DEFAULT_ADMIN_ROLE')();
    await (await node.contract.getFunction('revokeRole')(role, signer)).wait();
    const { payment } = await checkout(BUYER, 1);
    await simulate(BUYER, payment.id, 'paid');
    const [t] = await waitMinted(payment.id, 1);
    await refund(payment.id);
    const failed = await waitFor(() => cancelTx(t.id, 'FAILED'), 20_000, 'failed cancel');
    expect(failed.errorMessage).toContain('pnpm chain:grant-admin:local');
    // Not retried by the sweep until it cools down, then picked up again.
    expect(await ctx.app.get(CancelService).cancelsToSweep()).not.toContain(t.id);
    expect(await ctx.app.get(CancelService).cancelsToSweep(new Date(Date.now() + 11 * 60_000))).toContain(t.id);
    expect(await onChainStatus(t.tokenId!)).toBe(1); // still Valid
    const recon = await ctx.app.get(ReconciliationService).report({ limit: 500 });
    expect(recon.rows.find((r) => r.paymentId === payment.id)?.status).toBe('INVESTIGATE');
    const monitor = await (await ctx.login('admin@ticketpay.example')).get('/v1/admin/blockchain?status=FAILED');
    expect(monitor.body.transactions.map((x: { ticketId: string }) => x.ticketId)).toContain(t.id);

    await (await node.contract.getFunction('grantRole')(role, signer)).wait();
    const retry = await (await ctx.login('admin@ticketpay.example')).post(`/v1/admin/blockchain/tickets/${t.id}/retry`).set(csrf).send({ action: 'cancel' });
    expect(retry.status).toBe(200);
    await waitFor(() => cancelTx(t.id, 'CONFIRMED'), 20_000, 'cancel after retry');
    expect(await onChainStatus(t.tokenId!)).toBe(3);
  });

  // Keep last: it stops the chain node.
  it('a chain outage never undoes a paid order: tickets are issued and wait for the chain', async () => {
    await node.stop();
    const { payment, agent } = await checkout(BUYER, 1);
    expect((await simulate(BUYER, payment.id, 'paid')).status).toBe(200);
    const [t] = await waitFor(
      async () => {
        const rows = await ticketsOf(payment.id);
        return rows.length === 1 && rows[0].mintStatus === 'FAILED' ? rows : null;
      },
      15_000,
      'mint to give up',
    );
    expect(t).toMatchObject({ status: 'ACTIVE', tokenId: null });
    expect((await agent.get(`/v1/payments/${payment.id}`)).body.status).toBe('PAID');
    expect(await ctx.app.get(ChainClient).status()).toMatchObject({ ready: false });
    // Picked up again by the sweep once it has cooled down.
    expect(await ctx.app.get(MintService).ticketsToSweep(new Date(Date.now() + 11 * 60_000))).toContain(t.id);

    // The gate still admits, and never claims the on-chain redeem happened.
    expect((await admit(agent, t.id)).body.outcome).toBe('ADMITTED');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await redemptionOf(t.id)).chainStatus).not.toBe('CONFIRMED');
    const detail = await agent.get(`/v1/tickets/${t.id}`);
    expect(detail.body.status).toBe('REDEEMED');
    expect(detail.body.chain.redeemStatus).not.toBe('CONFIRMED');
    expect(detail.body.chain.redeemTxHash).toBeNull();
    expect(await ctx.app.get(RedeemService).redemptionsToSweep(new Date(Date.now() + 11 * 60_000))).toContain(t.id);
  });
});
