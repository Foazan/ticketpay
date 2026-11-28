# TicketPay

Digital event ticketing platform with an integrated Payment Facilitator and Ethereum NFT tickets.

**Academic prototype.** Payments run in Midtrans Sandbox (or a labelled mock), tickets are recorded on the Ethereum Sepolia testnet, and no real funds are processed. TicketPay is not a licensed Payment Service Provider (PJP). All events, organizers and people in the seed data are fictional.

## Status

Phases 2 (foundation), 3 (customer and organizer frontend), 4 (Payment Facilitator), 5 (NFT tickets), 6 (QR and gate) and 7 (organizer and admin dashboards) are done.

| Area | State |
|---|---|
| Monorepo, Docker Compose, environment config | Done |
| Database schema (21 tables), migrations, seed with 12 events | Done |
| API: auth, role-based access control, public catalog | Done |
| Checkout with 15-minute quota hold, Payments API with idempotency, Midtrans Snap Sandbox and labelled mock adapters | Done |
| Signature-verified Midtrans notifications, forward-only state machine, ledger, ticket issuance (off-chain rows) | Done |
| Signed merchant webhooks with retries (BullMQ), merchant API keys, expiry sweep | Done |
| ERC-721 ticket contract (non-transferable, role-based), minting after verified payment on a local chain or Sepolia | Done |
| Web: homepage, explore, event detail, login, sign up, checkout, demo payment page, payment status, My Tickets, ticket page with ownership record | Done |
| Rotating single-use entry QR, gate scanner (camera and manual code), single-use redemption, on-chain redeem | Done |
| Organizer registration and dashboard: events, ticket categories, posters, transactions, sales analytics, ledger, reconciliation, merchant settings | Done |
| Admin dashboard: merchant approval and suspension, event moderation, payments, ledger, reconciliation, service fee, webhook and blockchain monitoring with retries, gate staff, audit log | Done |
| Simulated refund (`POST /v1/payments/:id/refund`) with ledger reversal and on-chain cancel | Done |
| Account page for every role: edit name and phone, change password | Done |

How payments work, the API, and how merchants verify webhooks: [docs/payments.md](docs/payments.md).
How NFT tickets work, the custodial model and Sepolia setup: [docs/blockchain.md](docs/blockchain.md).
How the entry QR and the gate work: [docs/gate.md](docs/gate.md).
The organizer dashboard, event rules and reconciliation: [docs/organizer.md](docs/organizer.md).
The admin dashboard, merchant decisions, fee settings and the simulated refund: [docs/admin.md](docs/admin.md).

## Stack

- **Web:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- **API:** NestJS 11, TypeScript, REST
- **Database:** PostgreSQL 16 with **Drizzle ORM** (see the note below)
- **Payments:** Midtrans Snap Sandbox, or a clearly labelled mock mode that needs no credentials
- **Blockchain:** Solidity 0.8.28 with OpenZeppelin 5, Hardhat 2, ethers v6; Ethereum Sepolia testnet or a local Hardhat chain
- **Queues:** Redis 7 with BullMQ (merchant webhook delivery, order expiry, minting)
- **Tests:** Jest and Supertest against real PostgreSQL and Redis; Playwright for browser flows

> **Why Drizzle and not Prisma:** the original plan named Prisma. It was replaced because Prisma's engine binaries could not be downloaded in the environment where this code is built and tested, which would have left the backend unverified. Drizzle is pure TypeScript and gives the same PostgreSQL schema and constraints.

## Repository layout

```
apps/api            NestJS API (auth, events, organizer, tickets, gate, admin, audit)
apps/web            Next.js web app
packages/database   Drizzle schema, SQL migrations, seed, poster generator
packages/shared     Zod schemas and types shared by API and web
blockchain          TicketPayTicket contract, Hardhat tests, deploy and verify scripts
infrastructure      docker-compose.yml and helper scripts
```

## Setup

Requirements: Node.js 20 or newer, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
pnpm secrets            # prints JWT_SECRET and two more; paste the three lines into .env
pnpm infra:up           # PostgreSQL on 5432, Redis on 6379
pnpm db:migrate         # creates the tables
pnpm db:seed            # loads the fictional demo data
pnpm dev                # API on http://localhost:4000, web on http://localhost:3000
```

`pnpm db:reset` drops everything, migrates and seeds again.

Tickets are off-chain only until you turn the chain on. To mint them as NFTs on a local chain with no accounts needed, see [docs/blockchain.md](docs/blockchain.md#running-it-locally-no-accounts-needed).

**Updating from an earlier version:** pull, run `pnpm install`, make sure `.env` has `WEBHOOK_SECRET_ENC_KEY` (from `pnpm secrets`) and compare it with `.env.example` for new variables, then `pnpm db:migrate` and `pnpm db:seed`.

### Trying a purchase

With the default `PAYMENT_PROVIDER=mock`, open an event, choose tickets and click **Buy tickets**. After paying you land on a page marked **DEMO PAYMENT** where you choose success, failure or expiry. Each choice goes through the same state machine, ledger and ticket issuance as a real Midtrans notification. To use the real Midtrans sandbox instead, see the last section of [docs/payments.md](docs/payments.md).

### Demo accounts

Password for all of them: `TicketPay123!` (local development only).

| Role | Email | Lands on |
|---|---|---|
| Buyer | buyer@ticketpay.example | /buyer/tickets |
| Organizer (Arunika Live Entertainment, approved) | organizer@ticketpay.example | /organizer |
| Gate staff | gate@ticketpay.example | /gate |
| Administrator | admin@ticketpay.example | /admin |

Also seeded: `buyer2@`, `organizer2@`, `organizer3@` (approved merchants), `organizer4@` (merchant pending approval) and `gate2@`, all `@ticketpay.example`.

## Opening TicketPay from another device

The browser only ever talks to the web app's own address: `/v1` and `/media` are forwarded to the API (see `apps/web/next.config.mjs`). One address therefore serves everything, including the Midtrans notification URL. Keep `NEXT_PUBLIC_API_URL` empty in `.env` for this.

**On the same Wi-Fi** (a phone, a teammate's laptop):

1. Find the laptop's address with `ipconfig` (Windows, "IPv4 Address") or `ip addr`, for example `192.168.1.10`.
2. Add it to `.env` as `DEV_ALLOWED_ORIGINS=192.168.1.10` and restart `pnpm dev`. Allow Node.js through the firewall for private networks when Windows asks.
3. Open `http://192.168.1.10:3000` on the other device.

Browsers allow the camera only on HTTPS, so over plain http the gate scanner uses the manual code.

**From anywhere, with HTTPS** (camera scanning works, and Midtrans can reach you):

1. Run `ngrok http 3000`, tunnelling the web port, not the API port.
2. In `.env`, set `WEB_ORIGIN` and `API_PUBLIC_URL` to the `https://….ngrok-free.app` address, then restart `pnpm dev`.
3. In the Midtrans dashboard, set the notification URL to `https://….ngrok-free.app/v1/webhooks/midtrans`.
4. Use that address on every device, the laptop included. A session belongs to the address you logged in on.

The free ngrok address changes on each restart; repeat steps 2 and 3 when it does.

## Tests

```bash
createdb ticketpay_test   # once; or: docker exec -it ticketpay-postgres-1 createdb -U ticketpay ticketpay_test
pnpm test
```

The API tests migrate and seed `ticketpay_test`, use Redis database 1, and call the API over HTTP. Set `TEST_DATABASE_URL` or `TEST_REDIS_URL` to change them. 120 tests cover the catalog, authentication, CSRF, rate limiting, orders and quota, idempotency, the Midtrans adapter (against a local fake), webhooks, data isolation, organizer event management and reconciliation, the admin API and simulated refunds, account editing, QR and gate validation, and minting, on-chain redeem and refund cancels (against a Hardhat node the suite starts itself). `pnpm chain:test` runs the 22 contract tests.

| Test matrix | Covered by |
|---|---|
| T1 successful payment | payments and midtrans suites, plus the browser test |
| T2 failed, T3 expired | payments suite (T2 also in the browser test) |
| T4 duplicate notification, T6 out-of-order | payments and midtrans suites |
| T5 invalid provider signature | midtrans suite |
| T7 merchant webhook failure, T8 invalid HMAC | payments suite |
| T20 to T24 access control and overselling | app, payments, organizer and admin suites (every organizer and admin route is checked for T20; organizer routes for T21; T24 also through quota edits) |
| Simulated refund: ledger reversal, quota release, `payment.refunded`, on-chain cancel | admin and chain suites, and the browser suite |
| T9 to T14 contract rules | contract suite (`pnpm chain:test`) |
| Mint only after verified payment, no double mint, crash recovery | chain suite |
| T15 to T19 QR and gate, T22 gate staff cannot touch payments | gate suite, and the browser suite (camera scanning with a fake camera) |

Browser tests (Playwright) run against a running stack with a freshly seeded database:

```bash
pnpm db:seed && pnpm dev          # in one terminal
pnpm test:e2e                     # in another; first time: pnpm --filter @ticketpay/web exec playwright install chromium
```

The camera scanning test needs `ffmpeg` on the PATH: it turns the buyer's live QR into a fake camera feed. Logins are limited to 10 a minute per address, so wait a minute between repeated runs, and reseed (`pnpm db:reset`) before a full rerun.

Other checks: `pnpm typecheck` and `pnpm build`.

## Environment variables

Every variable is listed with its source in `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` and `WEBHOOK_SECRET_ENC_KEY`. Midtrans keys are only needed with `PAYMENT_PROVIDER=midtrans`; Chain settings are only needed with `CHAIN_MODE=local` or `sepolia` (see [docs/blockchain.md](docs/blockchain.md)). A missing or invalid value stops the API at start-up with a message naming the variable.

## Security notes

- Passwords are hashed with argon2id. Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie that carries a session version: changing the password on the Account page raises it, which signs out every other device.
- Every API route requires a session unless marked public, and role checks run on the server on every request.
- State-changing requests must send the `x-ticketpay-csrf` header; CORS only allows `WEB_ORIGIN`.
- Organizer and ticket queries filter by the merchant or user id from the session, never from the request.
- The database refuses overselling through a CHECK constraint on `ticket_tiers`.
- A ticket is issued only after the API applies a verified provider update. The browser's return from the payment page is never trusted.
- NFTs are minted only by a backend worker after the PAID transition is committed. The contract also refuses a second mint for the same payment reference.
- The blockchain signer key stays in the API process and is never logged or sent to the browser. Use test-only wallets: see the custodial note in [docs/blockchain.md](docs/blockchain.md#custodial-model-security-note).
- The Midtrans server key, merchant API keys and webhook secrets never reach the browser. API keys are stored hashed; webhook secrets are encrypted with AES-256-GCM.

## Design

Figma: https://www.figma.com/design/qUoVERB4BoDoqLEZCzsuIc. The Tailwind tokens in `apps/web/tailwind.config.ts` use the same names and values as the Figma variables.
