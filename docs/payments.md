# Payment Facilitator

How TicketPay takes payments for organizers (merchants), and how a merchant integrates with it.

**Academic prototype.** Payments run in Midtrans Sandbox or in a labelled mock mode. TicketPay is not a licensed Payment Service Provider (PJP), no real money is moved, and the balances shown are internal estimates, not settled funds.

## Flow

1. The buyer picks tickets and opens checkout. `GET /v1/checkout/quote` prices the cart; nothing is held yet.
2. On **Pay**, the web app calls `POST /v1/orders`. The API holds the tickets for 15 minutes with a conditional update per tier, so two buyers can never hold the same last ticket. A `CHECK (sold_count + held_count <= quota)` constraint backs this up in the database.
3. The web app calls `POST /v1/payments` with an `Idempotency-Key`. The API creates the Midtrans Snap transaction on the server and returns its `redirectUrl`.
4. The buyer pays on Midtrans (or on the demo page in mock mode).
5. Midtrans sends a notification to `POST /v1/webhooks/midtrans`. The API checks the signature, confirms the status with Midtrans' Get Status API, checks the amount, and applies the update.
6. In **one database transaction**: the notification is recorded under a unique dedupe key, the payment moves forward (never backwards), the order and quota change, ledger entries are written, ticket rows are issued, and a merchant webhook delivery is queued.
7. A BullMQ worker delivers the signed webhook to the merchant, retrying with exponential backoff.
8. The buyer's status page polls `GET /v1/orders/:id`. The redirect back from Midtrans is never treated as proof of payment.

Orders whose hold ran out are expired by a sweep every 30 seconds, after a 2-minute grace period. For Midtrans payments the sweep asks Midtrans first, so a payment that did succeed is applied as paid instead of being expired.

## Payment states

| From | Allowed to |
|---|---|
| PENDING | PAID, FAILED, EXPIRED |
| PAID | REFUND_PENDING, REFUNDED |
| REFUND_PENDING | REFUNDED |
| FAILED, EXPIRED, REFUNDED | none |

Every update is stored in `payment_webhook_events` with one of these outcomes:

| Outcome | Meaning |
|---|---|
| APPLIED | The payment moved forward |
| DUPLICATE | Same notification again, or no change in state |
| IGNORED_STALE | Would move the payment backwards (out-of-order notification) |
| UNSUPPORTED | Unknown order, or a status the prototype does not act on (partial_refund) |
| REJECTED | Bad signature, missing fields, or the amount does not match |

Midtrans status mapping (from the Midtrans notification docs, checked 22 Nov 2026): `settlement` and `capture` with fraud status `accept` or none are PAID; `capture` with `deny` is FAILED; `pending` and `authorize` are PENDING; `deny`, `cancel` and `failure` are FAILED; `expire` is EXPIRED; `refund` is REFUNDED.

## Ledger

Each paid payment writes three append-only entries, keyed so a replayed notification cannot write them twice:

| Type | Amount |
|---|---|
| GROSS_SALE | Total collected (tickets plus service fee) |
| SERVICE_FEE | TicketPay fee at the rate stored on the order |
| MERCHANT_NET | Ticket subtotal, before provider fees |

The provider fee (MDR) is not reported by the sandbox, so no PROVIDER_FEE entry is written. The service fee rate comes from `platform_fee_settings`; the seeded 3% is an illustrative assumption, not an approved tariff.

## API

All amounts are integer rupiah.

### Authentication

- **Buyers** use the browser session cookie and must send `x-ticketpay-csrf: 1` on POST requests.
- **Merchant servers** send `Authorization: Bearer <api key>`. Create a key in the organizer dashboard (`POST /v1/organizer/api-keys`); it is shown once. Only its prefix and a SHA-256 hash are stored. A merchant can only create or read payments for its own orders.

### `GET /v1/checkout/quote?event=<slug>&items=<tierId>:<qty>,...`

Public. Returns lines, `subtotal`, `feeRateBps`, `serviceFee` and `total`. Errors: 400 (wrong tier, sales closed, over 6 tickets), 404 (event not on sale), 409 (not enough tickets).

### `POST /v1/orders` (buyer)

```json
{ "eventSlug": "soundwave-festival-2026", "items": [{ "tierId": "…", "quantity": 2 }],
  "checkoutKey": "uuid made once per checkout page", "buyerName": "Rania Putri", "buyerEmail": "buyer@ticketpay.example" }
```

201 with the order, or 200 with the same order if `checkoutKey` was already used. 409 when tickets ran out or the buyer already has 3 unpaid orders.

### `POST /v1/payments`

Header `Idempotency-Key` (8 to 100 characters) is required.

```json
{ "orderId": "…", "method": "VA" }
```

`method` is `VA`, `QRIS` or `EWALLET`, limited to what `GET /v1/payments/methods` returns. Responses:

| Status | When |
|---|---|
| 201 | Payment created. Body has `id`, `reference`, `status`, `redirectUrl`, `snapToken`. |
| 200 + `Idempotent-Replayed: true` | Same key and same body as before. Same payment returned. |
| 409 | Same key with a different body; another payment already exists for the order; or the order expired. |
| 502 | Midtrans unavailable. Retry with the same key. |

### `GET /v1/payments/:id`

Buyer (own orders) or merchant API key (own payments). 404 otherwise.

### `POST /v1/webhooks/midtrans`

For Midtrans only. Set it as the Payment Notification URL in the Midtrans sandbox dashboard.

### Organizer settings (organizer session)

| Route | Purpose |
|---|---|
| `GET/POST /v1/organizer/api-keys`, `DELETE /v1/organizer/api-keys/:id` | List (masked), create (shown once), revoke |
| `PUT /v1/organizer/webhook` `{ "url": "https://…" }` | Set the webhook URL. The first time, returns the webhook secret once. |
| `POST /v1/organizer/webhook-secret/rotate` | New secret, shown once |
| `GET /v1/organizer/transactions`, `/ledger`, `/webhook-deliveries` | Own data only |

`POST /v1/merchants` (admin) onboards an approved sub-merchant with its first API key and webhook secret, returned once.

## Merchant webhooks

Events: `payment.paid`, `payment.failed`, `payment.expired`. One delivery per payment and event type.

```http
POST https://merchant.example/webhooks/ticketpay
content-type: application/json
x-ticketpay-event-id: evt_…
x-ticketpay-timestamp: 1795850000
x-ticketpay-signature: v1=5f2c…

{"id":"evt_…","type":"payment.paid","created_at":"…","merchant_id":"…","payment_reference":"PAY-…",
 "data":{"payment_id":"…","order_id":"…","order_number":"TP-…","amount":309000,"currency":"IDR","status":"PAID","method":"VA","paid_at":"…"}}
```

### Verifying a delivery

The signature is `v1=` followed by the hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed with your webhook secret. Verify it on the **raw** request body, before parsing JSON.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyTicketPayWebhook(secret, headers, rawBody) {
  const ts = Number(headers['x-ticketpay-timestamp']);
  const sig = headers['x-ticketpay-signature'] ?? '';
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false; // reject replays
  const expected = 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

Then:

- Answer any 2xx quickly. Anything else is retried.
- Deduplicate on `x-ticketpay-event-id`: a retry carries the same id.

### Retries

Up to `WEBHOOK_MAX_ATTEMPTS` (default 6) with exponential backoff starting at `WEBHOOK_RETRY_BASE_MS` (default 30 s): about 30 s, 1 min, 2 min, 4 min, 8 min. After the last attempt the delivery is marked FAILED. Each attempt's status code and error are visible in `GET /v1/organizer/webhook-deliveries`. A failing merchant endpoint never affects the payment, the ledger or the tickets.

In development, the seeded organizer (Arunika) sends its webhooks to `POST /v1/dev/webhook-receiver`, a built-in demo receiver that runs the same verification. Admins and organizers can see what it received at `GET /v1/dev/webhook-receiver`. All `/v1/dev` routes are disabled when `NODE_ENV=production`.

## Testing with the Midtrans sandbox

The automated tests use a local fake of Midtrans. To check the real sandbox:

1. Create a Midtrans account and switch the dashboard to **Sandbox**. Copy the server key and client key from Settings, Access Keys.
2. In `.env` set `PAYMENT_PROVIDER=midtrans`, `MIDTRANS_SERVER_KEY` and `MIDTRANS_CLIENT_KEY`. If a method group is not active in your account, remove it from `MIDTRANS_ENABLED_METHODS`.
3. Midtrans must reach your API to send notifications. Run a tunnel such as `ngrok http 4000` and set its HTTPS URL plus `/v1/webhooks/midtrans` as the Payment Notification URL in the sandbox dashboard settings.
4. Restart the API and buy a ticket. On the Midtrans page, pick a method and complete it with the sandbox simulator:
   - BCA Virtual Account: copy the VA number into https://simulator.sandbox.midtrans.com/bca/va/index
   - QRIS or GoPay on desktop: copy the QR image URL into https://simulator.sandbox.midtrans.com/v2/qris/index
5. The status page turns to **Payment verified** once the notification arrives. If it does not, check the API log and the `payment_webhook_events` table for REJECTED rows.
