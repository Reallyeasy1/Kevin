---
paths:
  - "packages/payments/**"
  - "apps/seller/**"
  - "apps/api/**"
---

# Payment and settlement rules (PRD §9.3, §15.2)

These are hard invariants. Do not trade them away for a smaller diff.

- INV-001: no upstream inference call before payment is verified.
- INV-002: no signing before the policy engine approves the exact payment.
- INV-003: at most one submitted payment per invoice or route. Use a DB uniqueness constraint plus locking (SEC-007), never an in-memory flag.
- INV-005: quoted amount, asset, destination, network and invoice binding are immutable once obtained. Revalidate all of them immediately before signing (SEC-005).
- INV-006: money is a decimal string or `decimal.js` value. Never `number`, never `parseFloat`, never arithmetic on drops as floats.
- INV-007 / SEC-002: the wallet seed and upstream API keys live only in server-side env. Never log them, never return them from an API, never write them to source or the database.
- INV-009: only a validated `tesSUCCESS` on a validated ledger produces `SETTLED`. A facilitator acknowledgment alone is not enough.
- SEC-003: every outbound URL must come from the offer registry. Reject user-supplied endpoints.
- SEC-009: never expose the raw signed transaction blob through a public API.
- SEC-010: fail startup if the XRPL network is Mainnet while `APP_ENV=hackathon`.

XRPL transaction shape: payer-signed `Payment`, bounded `LastLedgerSequence`, invoice binding via `InvoiceID` or memo as the seller requires, and never the partial-payment flag.

Keep `xrpl.js` and the x402 SDK types inside the adapter package. Routing and UI code must only see `PaymentClient` and `WalletSigner`.

Live Testnet tests are manual and gated; they must never run on ordinary CI commits.
