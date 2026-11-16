# SolPredict Arena — Architecture

## The protocol (v1, devnet)

No custom on-chain program. Only two native Solana programs are used:

- **System Program** — SOL transfers (bets in, payouts out).
- **Memo Program** (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) — the bet
  record. Every bet is a transfer to the market vault **plus** a memo:

```
ARENA:v1|bet|<marketId>|YES|NO
```

Anyone can audit a market without trusting the app: list the vault's incoming
transfers on Solscan and read the memos. The app's own bet log is a cache of
the same data.

## Market lifecycle

```
create  ->  open (bets)  ->  deadline passes  ->  resolved  ->  settled
```

- **create**: the creator's browser generates a fresh vault `Keypair`. The
  vault public key is the market's escrow address; the secret key stays in
  the creator's `localStorage` (exportable from the UI via the activity log —
  the key itself is never displayed, but the creator can copy it from
  localStorage under `solpredict-arena-v1`).
- **bet**: `SystemProgram.transfer(bettor -> vault, lamports)` + memo.
  Min 0.01 SOL, max 0.5 SOL per bet. The bettor pays the transaction fee.
- **resolve**: after the deadline, anyone clicks "Close & resolve". The app
  fetches SOL/USD from CoinGecko (free endpoint, no key) and derives the
  outcome: `above` markets resolve YES iff price >= target, `below` markets
  YES iff price <= target. The settlement price and its source are recorded
  on the market. If CoinGecko is unreachable, a manual price can be entered
  (recorded as manual).
- **settle**: only the vault holder (the browser holding the vault key) can
  settle. Payouts are computed by `computePayouts` in `docs/arena.js`:
  winners split the **entire** pool pro-rata by stake, integer lamports,
  dust (at most a few lamports from flooring) goes to the largest winner so
  the vault empties exactly. If nobody bet the winning side, every bettor is
  refunded in full. Payout fees (5,000 lamports per payout tx) are paid by
  the vault and deducted from the largest winner's payout. Each payout is its
  own transaction, signed by the vault keypair, with a Solscan link.

## Trust model (honest)

This is a **demo-grade** trust model, stated plainly because the judges
should know what it is:

- The vault key is held by the market creator in their browser. Before the
  deadline, the creator *could* in theory move the funds — that is why this
  ships on **devnet only, with free test SOL that has no value**.
- After settlement, the vault key can be published so anyone can verify the
  vault is empty and the payouts match the bets. The transparency is real;
  the pre-deadline trust is not eliminated, only disclosed.
- The production version of this design is a one-step change: replace the
  vault keypair with an Anchor program that holds the escrow and enforces
  `resolve`/`claim` on-chain. The market math, memo format, and UI are
  already written so that swap is mechanical.

## Demo mode

A toggle switches the app to a mock connection + mock wallet. The same code
paths run (same state updates, same settlement math); signatures are
deterministic fakes and balances are tracked in-memory. Judges can click the
whole flow — create, bet, close, settle — with no wallet installed.

## Files

```
docs/
  index.html   — the dapp (GitHub Pages serves this folder)
  app.js       — wallet, transactions, rendering, demo mode
  arena.js     — pure market logic (also imported by the Node tests)
test/
  arena.test.js — 9 tests, node:test, stdlib only
scripts/
  simulate-flow.mjs — full lifecycle simulation, no network
  verify-devnet.mjs — live devnet checks, no funds needed
```

## Why no Anchor program?

Two reasons, both practical. First, the toolchain install on this VM was
interrupted by a security flag on the install script's output, and the
fallback decision was to ship with native programs only rather than fight
the environment. Second, for a prediction market the escrow logic is fully
expressible as transfers + memos, and that keeps the demo deployable as a
static site with zero backend and zero program deployment — which is exactly
what a judge can verify in one click. The Anchor upgrade path is documented
above.
