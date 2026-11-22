# QR codes and gate validation

How a buyer's ticket gets them through the gate, and why a screenshot, a forged code or two gates scanning at once cannot let anyone in twice.

## The buyer's QR

The ticket page (`/buyer/tickets/<id>`) shows an entry QR while the ticket is active.

- **Opaque.** The QR holds `TP1.` followed by 32 random characters (24 random bytes). It contains no ticket id, name, email or event. A guessed or incremented value finds nothing.
- **Hashed at rest.** The API stores only the SHA-256 of the token in `ticket_qr_tokens`, with the ticket, the owner it was issued to and an expiry time. A database leak gives no usable QR.
- **Short-lived.** Each code is accepted for 90 seconds. The page fetches a new one every 30 seconds and whenever it comes back into view, so a screenshot or forwarded photo stops working almost at once.
- **Single use.** The token is marked used in the same transaction that admits the holder.
- **Owner only.** `GET /v1/tickets/:id/qr` answers only the ticket's owner. For anyone else the ticket does not exist (404).

Under the QR is a **manual code** (`TP-XXXX-XXXX`, Crockford base32 without I, L, O and U so it can be read aloud). It is the fallback when the gate camera cannot read the screen. It is shown only to the owner and only while the ticket is active. Gate endpoints are rate limited, so guessing codes is not practical.

## The gate screens

Gate staff log in with a `GATE_STAFF` account.

1. **`/gate`**: the events an administrator assigned to them, with how many tickets have been admitted.
2. **`/gate/<eventId>`**: the scanner.
   - The camera reads the QR automatically (jsQR in the browser). Browsers allow the camera only on HTTPS or `localhost`.
   - If there is no camera, staff type the manual code. Case, spaces and dashes do not matter.
   - A scan only **validates**. If the ticket is valid, staff see the holder's name, tier and ticket number, and press **Admit** to redeem it. **Don't admit** leaves the ticket untouched.
   - **ID check.** When an event requires it, staff tick "This event requires an ID check". Admit then stays disabled until they confirm they compared a photo ID with the holder's name. Nothing is photographed or stored.
   - On a phone the result appears above the camera, so staff never scroll to read it.

Results:

| Outcome | Shown as | Meaning |
|---|---|---|
| `VALID` | green, with Admit | All checks pass. Nothing is changed yet. |
| `ADMITTED` | green | Redeemed. |
| `ALREADY_REDEEMED` | amber | Used before. Shows when and by which gate staff member. |
| `EXPIRED` | amber | The QR is older than 90 seconds. The holder should refresh the page. |
| `INVALID` | red | Unknown, forged or malformed QR or code. |
| `WRONG_EVENT` | red | The ticket is for another event. Its holder is not shown. |
| `NOT_PAID` | red | The payment or order is not settled. |
| `CANCELLED` | red | Cancelled, refunded or expired ticket. |
| `OWNERSHIP_MISMATCH` | red | The QR was issued to a previous holder, or the NFT is not at the holder's address. |

Gate staff see only what they need to admit someone: name, tier, ticket number and NFT id. No email, phone or payment data.

## Validation checks (section 9.3)

`POST /v1/gate/validate` and `POST /v1/gate/redeem` take `{ eventId, qr }` or `{ eventId, code }` and run, in order:

1. **Authorized staff.** The account must be assigned to `eventId` in `gate_event_permissions`, otherwise 403.
2. **Token validity.** The QR hash or manual code must match a ticket, otherwise `INVALID`.
3. **Event match.** `WRONG_EVENT` otherwise.
4. **Cancellation.** A cancelled or expired ticket, or a refunded order, gives `CANCELLED`.
5. **Payment status.** The payment and the order must both be `PAID`, otherwise `NOT_PAID`.
6. **Previous redemption.** `ALREADY_REDEEMED`, with time and staff name.
7. **Ownership.** The QR must have been issued to the ticket's current owner. The QR must also be unused and unexpired.
8. **On-chain ownership** (validate only, when the chain is on and the ticket is minted). The NFT owner must be the holder's custodial address. This check is limited to 3 seconds so a slow RPC never holds up a queue. If the chain cannot be reached it reports `SKIPPED` and does not block entry.

The ticket category (tier) is returned so staff can check wristbands or zones.

## Single-use redemption (section 9.4)

`redeem` runs every check again inside one database transaction:

1. `SELECT … FOR UPDATE` locks the ticket row. A second gate scanning the same ticket at the same moment waits here.
2. The QR token is marked used, but only if it was still unused.
3. The ticket goes from `ACTIVE` to `REDEEMED`, but only if it was still `ACTIVE`.
4. A row is inserted into `ticket_redemptions`. Its unique `ticket_id` is the final guard.

Whoever gets the lock second sees `REDEEMED` and gets `ALREADY_REDEEMED`. Tests fire ten simultaneous redeems of one QR from two gate accounts, and three QR codes plus the manual code for one ticket at once. Exactly one is admitted each time (T19).

Every admission is written to `audit_logs` (`ticket.redeemed`, with gate staff, event, method and IP address).

## On-chain redemption

The database decides admission, so the gate works at full speed even when Sepolia is slow. After the transaction commits, the API queues a `redeem` job on the same chain queue as minting (concurrency 1, job id `redeem-<ticketId>`). The job:

- waits for the mint first, if the ticket was admitted before its NFT existed;
- checks for an earlier redeem transaction and uses its receipt if it was mined;
- reads `ticketStatus` on the contract:
  - already Redeemed: recorded rather than sent again;
  - Cancelled: marked for manual reconciliation;
- calls `redeem(tokenId)` with the signer's `GATE_ROLE`, waits for confirmation and stores the transaction hash;
- sets `ticket_redemptions.chain_status` to `CONFIRMED`.

**Nothing claims an on-chain redeem that did not happen.** Until it is confirmed, the buyer's ticket page shows "On-chain redeem pending" (or "delayed, retrying"), and no transaction hash is shown. Failed jobs are retried with backoff, and a sweep re-queues pending redemptions every minute and failed ones every 10 minutes. A ticket cancelled on-chain is left for an administrator to reconcile (Phase 7).

## Test coverage

| Test | Where |
|---|---|
| T15 valid QR accepted, then admitted once | `apps/api/test/gate.e2e-spec.ts`, and in a browser with a fake camera showing the real QR in `apps/web/e2e/gate.spec.ts` |
| T16 invalid, forged, malformed and expired QR rejected | gate suite |
| T17 already redeemed: same QR, an older QR, or the manual code | gate suite, browser suite |
| T18 another buyer cannot get the QR; a QR issued to a previous holder fails | gate suite |
| T19 simultaneous redemptions: exactly one succeeds | gate suite |
| T22 gate staff cannot create, pay for or read payments and orders | gate suite |
| On-chain redeem, redeem before mint, crash recovery, chain outage | `apps/api/test/chain.e2e-spec.ts` |

## Trying it

1. Log in as `buyer@ticketpay.example`, buy a Soundwave Festival ticket and open it from My Tickets.
2. In another browser (or a private window), log in as `gate@ticketpay.example` (password `TicketPay123!`). Open **Gate**, then **Soundwave Festival 2026**.
3. Point the camera at the buyer's screen, or type the manual code shown under the QR.

On a phone over your local network the camera needs HTTPS. Over plain `http://<laptop-ip>:3000` use the manual code, or open the scanner on the laptop itself (`localhost`).
