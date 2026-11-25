# Admin dashboard

The platform side of TicketPay, at `/admin`, for accounts with the `ADMIN` role (seed: `admin@ticketpay.example`). Every figure is read from the database on each request; nothing is invented or cached. Every API route below is under `@Roles('ADMIN')`: anonymous clients get 401 and buyers, organizers and gate staff get 403 (T20). Every change an administrator makes writes an audit log row with their id, role and IP address.

This is an academic prototype. Payments run in the Midtrans sandbox and NFTs on the Sepolia testnet, refunds are simulated, and TicketPay is not a licensed payment service provider (PJP). The dashboard says so at the top of every page.

## Pages

| Page | What it shows and does |
|---|---|
| Overview | Gross collected, service fee revenue (net of refunds), payments by status, tickets issued, minted and admitted, merchants by status, events on sale, failed webhooks, blockchain status, paid volume per day for 30 days (WIB), reconciliation summary, and a "Needs attention" list linking to whatever needs action |
| Merchants | Every organizer, applications awaiting approval first, with paid volume and event count. Approve from the list |
| Merchant detail | Profile, events, paid payments and volume, active API keys, decision history from the audit log. Approve, reject, suspend or reactivate |
| Events | Every organizer's events with sell-through and gate staff count. Take a published event off sale (moderation) |
| Payments | Every payment, searchable by reference, order number or buyer, filterable by status and organizer |
| Payment detail | Payment and order, provider notifications, ledger lines, tickets with their chain transactions, merchant webhooks. Simulated refund |
| Ledger | Every ledger line across organizers, with totals per type; filter by type |
| Reconciliation | The organizer reconciliation report across all organizers, with an organizer column; each payment links to its detail page |
| Service fee | Current rate, rate history, and a form to set a new rate |
| Merchant webhooks | Every delivery with attempts, last HTTP status and error; retry a delivery that gave up |
| Blockchain | Network, contract and signer, transaction counts by type, failed mints and redeems waiting for retry, every chain transaction with an explorer link; retry mint, redeem or cancel |
| Gate staff | Create gate staff accounts; assign and remove the events each account may scan |
| Audit log | Every audited action, newest first, filterable by action prefix, record type and actor role, 50 per page |

The sidebar becomes a scrollable tab row on phones; wide tables scroll sideways inside their card.

## Merchant decisions

| Action | Allowed from | Reason | Effect |
|---|---|---|---|
| Approve | PENDING, REJECTED, SUSPENDED | Optional | The organizer can publish events and take payments |
| Reject | PENDING | Required, shown to the organizer | No publishing, no payments |
| Suspend | APPROVED | Required, shown to the organizer | Their events leave the marketplace, new orders are refused, and payments for existing unpaid orders are refused. Tickets already sold stay valid |

The update is conditional on the status the administrator saw, so two administrators acting at once cannot both succeed on stale data (the second gets 409). The public catalog, order creation and payment creation all check `merchants.status = 'APPROVED'` on every request, so a decision takes effect immediately.

## Service fee

`POST /v1/admin/fees` inserts a row into `platform_fee_settings`, effective now. Rates go from 0 to 10% (1000 basis points); anything above is refused as a likely typo. Each order stores the rate it was quoted (`orders.fee_rate_bps`), so a change applies to new quotes and orders only, never to orders already created.

## Simulated refund

`POST /v1/payments/:id/refund` with `{ "reason": "…" }` (at least 5 characters), administrators only. This is the refund endpoint named in the proposal. It moves no money and does not call Midtrans; it runs the refund through the same forward-only state machine as a provider notification (source `ADMIN`, dedupe key `admin-refund:<payment id>`).

In one transaction:

1. payment PAID → REFUNDED, order → REFUNDED;
2. the order's ACTIVE tickets → CANCELLED, and `sold_count` on each tier goes down by the cancelled quantity (the quota is released);
3. three ledger lines: `REFUND` debit of the amount paid, `SERVICE_FEE` credit and `MERCHANT_NET` debit that reverse the original lines. The fee and the organizer net then sum to zero for that payment;
4. a `payment.refunded` merchant webhook is queued.

After the commit, each cancelled ticket whose NFT was minted gets a `cancel` job on the chain queue (see below).

Refused cases: an unknown payment (404), a payment that is not PAID (409), and a payment with any ticket already admitted at the gate (409). A repeat on a refunded payment returns `alreadyRefunded: true` and changes nothing.

### On-chain cancel

`TicketPayTicket.cancel(tokenId)` requires `DEFAULT_ADMIN_ROLE`. The local deploy script and the test node grant that role to the backend signer. On Sepolia the signer only has the operational roles, so grant it once with the deployer key:

```bash
pnpm chain:grant-admin:sepolia
```

The trade-off is deliberate and documented in the script: the hot signer can then grant roles too. For a prototype that is acceptable; a production system would use a separate, cold admin key and a timelock.

The cancel job re-reads the contract first:

- already Cancelled: recorded as CONFIRMED, nothing sent;
- Redeemed on-chain: recorded as FAILED, needs an operator;
- signer lacks the admin role: recorded as FAILED with the command above as the hint, shown on the Blockchain page;
- otherwise sends `cancel`, waits for the receipt and records it.

A failed cancel shows as "Requires investigation" in reconciliation. The chain sweep retries it after 10 minutes, or an administrator can retry it from the Blockchain page once the cause is fixed.

## Retries

| Retry | Route | What it does |
|---|---|---|
| Merchant webhook | `POST /v1/admin/webhooks/:id/retry` | Only for a FAILED delivery. Sets it back to PENDING and queues a new job with a fresh retry budget. The event id stays the same, so the organizer can deduplicate |
| Mint | `POST /v1/admin/blockchain/tickets/:ticketId/retry` `{ "action": "mint" }` | For a ticket whose mint failed. Refused for minted or cancelled tickets |
| Redeem | same, `{ "action": "redeem" }` | For an admitted ticket whose on-chain redeem failed |
| Cancel | same, `{ "action": "cancel" }` | For a refunded ticket whose on-chain cancel failed |

Every chain job checks the contract before sending, so a retry never mints, redeems or cancels twice. With `CHAIN_MODE=disabled` the chain retries answer 409.

## Gate staff

`POST /v1/admin/gate-staff` `{ fullName, email, password }` creates a `GATE_STAFF` account (password at least 8 characters, hashed with Argon2id). `POST /v1/admin/gate-staff/:id/events` `{ eventId }` grants access to an event's gate; assigning twice keeps one grant. `DELETE /v1/admin/gate-staff/:id/events/:eventId` removes it. The gate app reads these grants on every request (see [gate.md](gate.md)).

## API

All under `/v1/admin`, administrator session, CSRF header on writes.

| Route | Purpose |
|---|---|
| `GET overview` | Dashboard figures |
| `GET merchants?status=` · `GET merchants/:id` | List and detail |
| `POST merchants/:id/approve` · `reject` · `suspend` `{ reason }` | Decisions |
| `GET events?status=` · `POST events/:id/unpublish` `{ reason }` | Event moderation |
| `GET payments?status=&merchantId=&q=` · `GET payments/:id` | Payments (latest 200) and detail |
| `GET ledger?merchantId=&type=` | Lines (latest 300) and totals per type |
| `GET reconciliation?merchantId=` | Reconciliation across organizers |
| `GET fees` · `POST fees` `{ feeRateBps, note }` | Service fee |
| `GET webhooks?status=` · `POST webhooks/:id/retry` | Merchant webhook deliveries |
| `GET blockchain?status=` · `POST blockchain/tickets/:ticketId/retry` `{ action }` | Chain monitoring |
| `GET gate-staff` · `POST gate-staff` · `POST gate-staff/:id/events` · `DELETE gate-staff/:id/events/:eventId` | Gate staff |
| `GET audit-logs?action=&entityType=&actorRole=&page=` | Audit log, 50 per page |

Plus `POST /v1/payments/:id/refund` `{ reason }` for the simulated refund.

## Tests

- `apps/api/test/admin.e2e-spec.ts` (17 tests): T20 on every admin route; overview figures against the database; approval lets a pending organizer publish; rejection needs a reason; suspension hides events and blocks orders and payments, and reactivation restores them; event moderation; a fee change affects only new quotes; refund cancels tickets, releases quota, nets the ledger to zero, sends `payment.refunded`, is idempotent, and is refused for unpaid payments and admitted tickets; payment detail; ledger totals; webhook retry; gate staff accounts and assignments; audit log filters and paging.
- `apps/api/test/chain.e2e-spec.ts`: a refund cancels the minted NFTs on-chain (status 3); without the admin role the cancel is recorded as failed with the fix, shows in reconciliation and monitoring, and an admin retry completes it after the role is granted.
- `apps/web/e2e/admin.spec.ts` (4 tests, Playwright): approving an organizer, a simulated refund seen in the payment detail and reconciliation, a fee change seen in a new quote, and gate staff setup.
