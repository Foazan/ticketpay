# TicketPay

Digital event ticketing platform with an integrated Payment Facilitator and Ethereum NFT tickets.

**Academic prototype.** Payments run in Midtrans Sandbox (or a labelled mock), tickets are recorded on the Ethereum Sepolia testnet, and no real funds are processed. TicketPay is not a licensed Payment Service Provider (PJP). All events, organizers and people in the seed data are fictional.

## Status

Phases 2 (foundation) and 4 (Payment Facilitator) are done.

| Area | State |
|---|---|
| Monorepo, Docker Compose, environment config | Done |
| Database schema (21 tables), migrations, seed with 12 events | Done |
| API: auth, role-based access control, public catalog | Done |
| Checkout with 15-minute quota hold, Payments API with idempotency, Midtrans Snap Sandbox and labelled mock adapters | Done |
| Signature-verified Midtrans notifications, forward-only state machine, ledger, ticket issuance (off-chain rows) | Done |
| Signed merchant webhooks with retries (BullMQ), merchant API keys, expiry sweep | Done |
| Web: homepage, explore, event detail, login, sign up, checkout, demo payment page, payment status, My Tickets list | Done |
| Organizer, gate and admin dashboards | Landing pages only; organizer finance data is available through the API |
| Reconciliation report, simulated refund | Not built (Phase 7) |
| Smart contract, minting on Sepolia, QR validation at the gate | Not built (Phases 5, 6) |

How payments work, the API, and how merchants verify webhooks: [docs/payments.md](docs/payments.md).

## Stack

- **Web:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- **API:** NestJS 11, TypeScript, REST
- **Database:** PostgreSQL 16 with **Drizzle ORM** (see the note below)
- **Payments:** Midtrans Snap Sandbox, or a clearly labelled mock mode that needs no credentials
- **Queues:** Redis 7 with BullMQ (merchant webhook delivery, order expiry)
- **Tests:** Jest and Supertest against real PostgreSQL and Redis; Playwright for browser flows

> **Why Drizzle and not Prisma:** the original plan named Prisma. It was replaced because Prisma's engine binaries could not be downloaded in the environment where this code is built and tested, which would have left the backend unverified. Drizzle is pure TypeScript and gives the same PostgreSQL schema and constraints.

## Repository layout

```
apps/api            NestJS API (auth, events, organizer, tickets, gate, admin, audit)
apps/web            Next.js web app
packages/database   Drizzle schema, SQL migrations, seed, poster generator
packages/shared     Zod schemas and types shared by API and web
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

## Tests

```bash
createdb ticketpay_test   # once; or: docker exec -it ticketpay-postgres-1 createdb -U ticketpay ticketpay_test
pnpm test
```

The API tests migrate and seed `ticketpay_test`, use Redis database 1, and call the API over HTTP. Set `TEST_DATABASE_URL` or `TEST_REDIS_URL` to change them. 59 tests cover the catalog, authentication, CSRF, rate limiting, orders and quota, idempotency, the Midtrans adapter (against a local fake), webhooks and data isolation.

| Test matrix | Covered by |
|---|---|
| T1 successful payment | payments and midtrans suites, plus the browser test |
| T2 failed, T3 expired | payments suite (T2 also in the browser test) |
| T4 duplicate notification, T6 out-of-order | payments and midtrans suites |
| T5 invalid provider signature | midtrans suite |
| T7 merchant webhook failure, T8 invalid HMAC | payments suite |
| T20 to T24 access control and overselling | app and payments suites |
| T9 to T19 blockchain and QR | not built yet |

Browser tests (Playwright) run against a running stack with a freshly seeded database:

```bash
pnpm db:seed && pnpm dev          # in one terminal
pnpm test:e2e                     # in another; first time: pnpm --filter @ticketpay/web exec playwright install chromium
```

Other checks: `pnpm typecheck` and `pnpm build`.

## Environment variables

Every variable is listed with its source in `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` and `WEBHOOK_SECRET_ENC_KEY`. Midtrans keys are only needed with `PAYMENT_PROVIDER=midtrans`; Sepolia credentials come with the blockchain phase. A missing or invalid value stops the API at start-up with a message naming the variable.

## Security notes

- Passwords are hashed with argon2id. Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie.
- Every API route requires a session unless marked public, and role checks run on the server on every request.
- State-changing requests must send the `x-ticketpay-csrf` header; CORS only allows `WEB_ORIGIN`.
- Organizer and ticket queries filter by the merchant or user id from the session, never from the request.
- The database refuses overselling through a CHECK constraint on `ticket_tiers`.
- A ticket is issued only after the API applies a verified provider update. The browser's return from the payment page is never trusted.
- The Midtrans server key, merchant API keys and webhook secrets never reach the browser. API keys are stored hashed; webhook secrets are encrypted with AES-256-GCM.

## Design

Figma: https://www.figma.com/design/qUoVERB4BoDoqLEZCzsuIc. The Tailwind tokens in `apps/web/tailwind.config.ts` use the same names and values as the Figma variables.
