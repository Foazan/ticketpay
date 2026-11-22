# Blockchain: NFT tickets

Every ticket that TicketPay issues after a verified payment can also be recorded as an ERC-721 token. This is an academic prototype: it runs on a local Hardhat chain or on the **Ethereum Sepolia testnet**, never on mainnet. The tokens have no monetary value.

## What goes on-chain, and what does not

| On-chain | Off-chain (PostgreSQL only) |
|---|---|
| Token id, numeric event id, tier code | Buyer name, email, phone |
| Status: Valid, Redeemed or Cancelled | Order, amounts, payment method, provider ids |
| `paymentRef`: a keccak256 hash of payment id, merchant id, amount and ticket number | The QR token and the manual validation code |
| Owner: the buyer's custodial address | Ledger, merchant data, audit logs |

The payment reference is a one-way hash, so the chain proves that a ticket came from a specific payment without revealing anything about it.

## The contract

`blockchain/contracts/TicketPayTicket.sol` (Solidity 0.8.28, OpenZeppelin 5).

| Function | Who can call it | What it does |
|---|---|---|
| `mintTicket(to, eventId, tier, paymentRef)` | `MINTER_ROLE` (the backend signer) | Mints a Valid ticket. Reverts if `paymentRef` is empty or already used, if the event has no supply set, or if the event is sold out. |
| `redeem(tokenId)` | `GATE_ROLE` (the backend signer) | Valid to Redeemed. A second redeem reverts. Used by the gate in the next phase. |
| `cancel(tokenId)` | `DEFAULT_ADMIN_ROLE` | Valid to Cancelled, for refunds. |
| `setEventSupply(eventId, max)` | `EVENT_MANAGER_ROLE` | Caps tokens per event. Can never go below what is already minted. |
| `platformTransfer(tokenId, to)` | `PLATFORM_ROLE` (granted to nobody today) | Reserved for a future official resale flow. |
| `ticketInfo`, `ticketStatus`, `tokenIdByPaymentRef`, `maxSupply`, `mintedCount`, `totalMinted` | anyone | Read-only views. |

Holders cannot transfer tickets: `transferFrom` and `safeTransferFrom` revert with `TransfersDisabled`, and `approve` and `setApprovalForAll` revert with `ApprovalsDisabled`, so no marketplace can move a ticket either. This blocks scalping on-chain.

Contract tests (`pnpm chain:test`, 22 tests) cover the test matrix:

| Test | Case |
|---|---|
| T9 | A payment reference that was already used reverts |
| T10 | Redeeming the same ticket twice reverts |
| T11 | Redeem by an account without `GATE_ROLE` reverts, including the ticket holder |
| T12 | Mint by an account without `MINTER_ROLE` reverts, including the admin |
| T13 | Direct transfer and approvals are rejected |
| T14 | Minting beyond the event supply reverts |

## How minting fits the payment flow

1. A payment becomes PAID only through a verified provider update: a Midtrans notification whose signature checks out and whose status the API confirms with Midtrans, or the labelled mock in demo mode. The browser can never cause it.
2. In the same database transaction the API issues one ticket row per seat with `mintStatus = PENDING`.
3. **After that transaction commits**, the API queues one mint job per ticket (BullMQ queue `chain`, job id `mint-<ticketId>`). If Redis is down at that moment, nothing is lost: a sweep every minute re-queues tickets that are still pending.
4. The chain worker runs with concurrency 1, so the signer sends one transaction at a time. For each ticket it:
   - checks for an earlier transaction that was sent but not recorded as confirmed, and uses its receipt if it was mined;
   - checks `tokenIdByPaymentRef` on the contract, so a ticket that is already on-chain is recorded rather than minted again;
   - derives and stores the buyer's custodial address;
   - raises the event supply on-chain if it is below the sum of the event's tier quotas;
   - sends `mintTicket`, records the transaction hash, waits for confirmation and stores the token id.
5. A failing mint is retried with exponential backoff (`MINT_MAX_ATTEMPTS`, `MINT_RETRY_BASE_MS`). After the last attempt the ticket is marked `FAILED` and the sweep tries again every 10 minutes. **A chain problem never undoes a payment:** the ticket stays valid off-chain and the buyer sees "On-chain record delayed".

Double minting is prevented three times over: the job id per ticket, the checks above, and the contract itself, which refuses a second mint for the same payment reference.

The buyer's ticket page (`/buyer/tickets/<id>`) shows the token id, contract, mint transaction, custodial address and payment reference, with Etherscan links on Sepolia. It refreshes itself while a mint is in flight.

API tests for this flow (`apps/api/test/chain.e2e-spec.ts`) start a real Hardhat node, deploy the contract and check: minting only after verified payment, no mint for failed or unpaid payments, one token per ticket under repeated notifications, recovery after a crash, and that a chain outage leaves the paid order intact.

## Custodial model (security note)

Buyers do not need a wallet. Each buyer gets a custodial address derived on the server:

```
address = address of private key keccak256(CUSTODIAL_MASTER_SECRET + ":" + userId)
```

The private keys are never stored or used, and nothing can be signed for a buyer: transfers are disabled in the contract anyway. Keep `CUSTODIAL_MASTER_SECRET` secret and never change it after tickets have been minted, or new tickets will go to different addresses than old ones.

This is a deliberate simplification for the prototype. In this model TicketPay controls the record of ownership. A production system would let buyers connect their own wallet or claim their token to it, and would keep the signer key in a key management service or hardware wallet rather than an environment variable.

**The signer key** (`SIGNER_PRIVATE_KEY`) can mint and redeem tickets. It stays in the API process, is never logged and is never sent to the browser. Use a fresh wallet that only ever holds Sepolia test ETH.

## Running it locally (no accounts needed)

```bash
pnpm chain:compile          # compiles the contract and exports the ABI to blockchain/export
pnpm chain:test             # 22 contract tests
pnpm chain:node             # terminal 1: a local chain on http://127.0.0.1:8545
pnpm chain:deploy:local     # terminal 2: deploys and writes blockchain/deployments/localhost.json
```

Then set `CHAIN_MODE=local` in `.env` and restart `pnpm dev`. Make sure `CUSTODIAL_MASTER_SECRET` is set (from `pnpm secrets`). Buy a ticket: within a second or two My Tickets shows **NFT #1 on local chain**.

The local chain forgets everything when it stops. After restarting `pnpm chain:node`, run `pnpm chain:deploy:local` again and `pnpm db:reset` so the database and the chain agree.

`GET /v1/health` reports the chain: mode, network, contract, signer address, and whether it is ready or what is wrong.

## Running it on Sepolia

You need three things. None of them costs money.

1. **An RPC endpoint.** Create a free app on [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/) for Ethereum Sepolia and copy its HTTPS URL into `SEPOLIA_RPC_URL`.
2. **Two test wallets.** Create two new accounts in MetaMask (or any wallet) used only for this project. Export their private keys into `DEPLOYER_PRIVATE_KEY` (deploys and becomes the contract admin) and `SIGNER_PRIVATE_KEY` (the backend wallet that mints). **Never use a wallet that holds real funds.**
3. **Sepolia test ETH** in both wallets from a Sepolia faucet, for example the ones run by Google Cloud or Alchemy. The deployer needs a little for one deployment; the signer pays for each mint, which costs a small fraction of test ETH.

Optional: an [Etherscan](https://etherscan.io/apis) API key in `ETHERSCAN_API_KEY` to publish the verified source code.

Private keys exported from MetaMask have no `0x` prefix; both forms work. Then:

```bash
pnpm chain:check:sepolia    # free pre-flight: prints both addresses and balances, lists anything missing
pnpm chain:fund-signer      # optional: sends 0.02 SepoliaETH from the deployer to the signer (one faucet claim is enough)
pnpm chain:deploy:sepolia   # deploys, grants the signer its roles, writes blockchain/deployments/sepolia.json
pnpm chain:verify:sepolia   # optional: verified source on Etherscan
```

Set `CHAIN_MODE=sepolia` in `.env` (and `TICKET_CONTRACT_ADDRESS` to the printed address, or leave it empty to read `deployments/sepolia.json`) and restart the API. Commit `blockchain/deployments/sepolia.json` so the team shares one contract.

Mints on Sepolia take about 12 to 30 seconds. The ticket page links each transaction to `https://sepolia.etherscan.io/tx/<hash>`.

## Environment variables

| Variable | Used for |
|---|---|
| `CHAIN_MODE` | `disabled` (default), `local` or `sepolia` |
| `LOCAL_RPC_URL` | Local Hardhat node, default `http://127.0.0.1:8545` |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint (required for `sepolia`) |
| `TICKET_CONTRACT_ADDRESS` | Contract address; empty means read `blockchain/deployments/<network>.json` |
| `DEPLOYER_PRIVATE_KEY` | Deploy script only. Never read by the API |
| `SIGNER_PRIVATE_KEY` | Backend minting wallet. In local mode it defaults to Hardhat's public test account #1 |
| `CUSTODIAL_MASTER_SECRET` | Derives buyers' custodial addresses (required whenever the chain is on) |
| `ETHERSCAN_API_KEY` | Source verification only |
| `CHAIN_CONFIRMATIONS` | Blocks to wait before a mint counts as confirmed (default 1) |
| `MINT_MAX_ATTEMPTS`, `MINT_RETRY_BASE_MS` | Retry policy for a failing mint |

## Not built yet

- Redeeming on-chain at the gate, with rotating QR codes (next phase, tests T15 to T19).
- Cancelling the token on a refund (admin phase).
- Letting a buyer claim their token to their own wallet.
