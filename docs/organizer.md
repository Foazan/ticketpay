# Organizer dashboard

The organizer (merchant) side of TicketPay, at `/organizer`. Every figure is computed from the database on each request. An organizer only ever sees their own merchant's rows: the merchant id always comes from the session, never from the request. Another organizer's event answers 404 (T21). Buyers, gate staff and admins get 403 on every organizer route (T20).

## Onboarding

`/sell` links to `/register/organizer`, which collects the fields from brief section 6.1:

- business name, organizer type, address, description;
- contact person, name, email, phone, password;
- an optional settlement note.

The settlement note is free text such as a bank name. The form tells organizers not to enter account numbers, because the prototype settles nothing.

A new merchant starts as **PENDING**. Until an administrator approves it, the dashboard shows a notice. The organizer can create drafts and ticket categories but cannot:

- publish an event;
- create API keys.

The publish check reads the merchant status fresh from the database, so approval takes effect without logging in again. Rejected and suspended merchants see their own notice.

## Pages

| Page | What it shows |
|---|---|
| Overview | Published events, tickets sold, ticket revenue, pending payments, estimated balance (labelled as an internal estimate), ticket revenue per day for 30 days (WIB days, today included), recent transactions, upcoming events with sell-through |
| Events | Every event with status, sell-through and revenue |
| Create event / Manage event | Details form, ticket categories, status actions, poster |
| Transactions | One row per order (section 6.4), filterable by status and event: order number, payment reference, buyer, event and ticket types, amount including fee, provider status beside TicketPay's status, tickets issued and minted, date |
| Sales analytics | Tickets per day (7, 30 or 90 days), fee breakdown, sales by ticket category, paid amount by payment method |
| Ledger | Totals (gross, service fee, organizer net and simulated refunds, each net of reversals) and the append-only entries with credit and debit |
| Reconciliation | Per-payment comparison of provider, ledger and chain (below) |
| Merchant settings | Profile, API keys, webhook, integration status, developer help |

Fee breakdown on the analytics page:

- gross collected;
- TicketPay service fee;
- provider fee, shown as "not known" because the sandbox does not report it;
- estimated organizer net.

Charts are a single series each, so they have no legend. Each one has a hover and keyboard tooltip per day and a "Show as table" view, so no value is available only on hover.

## Events and ticket categories

| Action | Rule |
|---|---|
| Create | Starts as a **draft** with a generated poster (the category gradient with the title). The address is the slugified title; a short suffix is added if it is taken. |
| Edit | Not allowed once archived. Changed dates must keep the event in the future and end after it starts. A generated poster follows title and category changes; an uploaded poster is kept. |
| Publish | Approved merchant, at least one ticket category, event not started, every category's sales end before the event ends. |
| Unpublish | Hides the event from the marketplace. Tickets already sold stay valid. |
| Archive | Only when not published. Archived events cannot be edited or published. |
| Delete | Only if the event never had an order (soft delete). Otherwise archive it, so its records stay. |
| Add category | Name unique per event, price Rp 1,000 to Rp 100,000,000 (a payment provider needs a positive amount), quota 1 to 100,000, sales window inside the event, at most 20 categories. The tier code used on-chain is assigned automatically. |
| Edit category | The quota can never go below tickets sold plus tickets held in checkout (T24). A conditional update and the table's CHECK constraint both enforce this. A new price applies to new orders only. |
| Remove category | Only if it never had an order. |

The same Zod schemas validate in the browser and in the API, so organizers see the same messages either way. Times are entered and shown in WIB.

### Posters

Posters are uploaded as PNG, JPEG or WebP, up to 2 MB, to `POST /v1/organizer/events/:id/poster` (multipart, field `poster`).

- **Type check:** the API reads the real type from the file's first bytes and ignores the declared content type and file name. SVG and HTML uploads are refused.
- **Storage:** files get random names in `UPLOAD_DIR` (default `apps/api/storage`).
- **Serving:** `GET /media/posters/:name` validates the name against a strict pattern and sends:
  - `X-Content-Type-Options: nosniff`;
  - a sandboxing `Content-Security-Policy`;
  - `Cross-Origin-Resource-Policy: cross-origin`, so the web app can show the poster.
- **Cleanup:** replaced posters are deleted.

## Reconciliation (section 6.6)

`GET /v1/organizer/reconciliation` takes the merchant's latest 300 payments. For each one it compares:

1. the provider's last status (`settlement` and `capture` mean collected);
2. TicketPay's payment and order status, and the ledger lines (gross must equal the amount paid; service fee plus organizer net must equal gross);
3. ticket issuance: tickets issued against the quantity ordered and, when the chain is on, tickets minted.

| Result | When |
|---|---|
| Matched | All records agree |
| Pending | Waiting for the buyer, or tickets being minted (within 15 minutes of payment) |
| Mismatch | The provider says paid but TicketPay does not, or the reverse. Also: paid without ledger lines, ledger amounts that do not add up, fewer tickets than ordered, or tickets or ledger lines for an unpaid payment. |
| Requires investigation | Failed mints, mints still missing after 15 minutes, failed on-chain redeems, or minted tickets for an unpaid payment |

Duplicate provider notifications are listed as a note, not a mismatch: providers retry, and TicketPay ignores repeats safely. Nothing here invents settlement data. The same service will power the admin reconciliation view in the next phase.

## Merchant settings

- **Profile:** contact details are editable. The business name, type and status belong to the approval and are not editable here.
- **API keys:** shown once at creation with a copy button, then only masked (`tp_test_xxxx.••••••••abcd`). Keys can be revoked.
- **Webhook:**
  - The URL must use HTTPS; plain http is allowed only for localhost in development.
  - The signing secret is shown once when created or rotated.
  - The settings page shows delivery results for the last 7 days.
- **Developer help:** how to create a payment with a key, and how to verify a webhook signature. See [payments.md](payments.md).

## Tests

- `apps/api/test/organizer.e2e-spec.ts`:
  - event lifecycle, server validation, publishing rules, deletion and archiving;
  - posters, including forged types and path tricks;
  - T20, T21 for every write route, and T24 through quota edits;
  - consistency between overview, analytics, events list and ledger;
  - every reconciliation finding.
- `apps/web/e2e/organizer.spec.ts`:
  - registration of a new organizer, who cannot publish until approved;
  - an approved organizer creating, pricing and publishing an event that then appears in the marketplace.

## Refunds

Only a TicketPay administrator can refund, and the refund is simulated (see [admin.md](admin.md)). The organizer sees its effects: the order and payment show as refunded, the tickets are cancelled and the quota returns to sale, the ledger gains a refund line and reversals of the fee and net lines (the estimated balance goes down by the ticket subtotal), and a `payment.refunded` webhook is sent if a webhook URL is set.
