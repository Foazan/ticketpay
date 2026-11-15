# TicketPay

Digital event ticketing platform with an integrated Payment Facilitator and Ethereum NFT tickets.

**Academic prototype.** Payments run in Midtrans Sandbox (or a labelled mock), tickets are recorded on the Ethereum Sepolia testnet, and no real funds are processed. TicketPay is not a licensed Payment Service Provider (PJP). All events, organizers and people in the seed data are fictional.

## Status

Phase 2 (foundation) is done. Later phases are not built yet.

| Area | State |
|---|---|
| Monorepo, Docker Compose, environment config | Done |
| Database schema (21 tables), migration, seed with 12 events | Done |
| API: auth, role-based access control, public catalog, role-scoped read endpoints | Done |
| Web: homepage, explore with filters, event detail, login, sign up, role landing pages | Done |
| Checkout, payments, ledger, webhooks, reconciliation | Not built (Phase 4) |
| Organizer, gate and admin dashboards | Landing pages only (Phases 3b, 6, 7) |
| Smart contract, minting, QR validation | Not built (Phases 5, 6) |

## Stack

- **Web:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3
- **API:** NestJS 11, TypeScript, REST
- **Database:** PostgreSQL 16 with **Drizzle ORM** (see the note below)
- **Cache and queues:** Redis 7 (used from Phase 4)
- **Tests:** Jest and Supertest against a real PostgreSQL database

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

The tests migrate and seed `ticketpay_test`, then call the API over HTTP. Set `TEST_DATABASE_URL` to use a different database. They cover the public catalog, authentication, CSRF, rate limiting, and test-matrix cases T20, T21 (read side), T22 and T23.

Other checks: `pnpm typecheck` and `pnpm build`.

## Environment variables

Every variable is listed with its source in `.env.example`. For Phase 2 only `DATABASE_URL` and `JWT_SECRET` are required. Midtrans and Sepolia credentials are needed from Phases 4 and 5.

## Security notes

- Passwords are hashed with argon2id. Sessions are a signed JWT in an httpOnly, SameSite=Lax cookie.
- Every API route requires a session unless marked public, and role checks run on the server on every request.
- State-changing requests must send the `x-ticketpay-csrf` header; CORS only allows `WEB_ORIGIN`.
- Organizer and ticket queries filter by the merchant or user id from the session, never from the request.
- The database refuses overselling through a CHECK constraint on `ticket_tiers`.

## Design

Figma: https://www.figma.com/design/qUoVERB4BoDoqLEZCzsuIc. The Tailwind tokens in `apps/web/tailwind.config.ts` use the same names and values as the Figma variables.
