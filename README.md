# SolPredict Arena — Play the SOL price on Solana devnet

A parimutuel prediction market on Solana **devnet**. Bet real devnet SOL on the
SOL/USD price, settle on-chain, audit every transaction.

Built for the **Indie.fun Hackathon** on
[Superteam Earn](https://superteam.fun/earn/listing/indiefun-hackathon-10kprize)
— $10,000+ prize pool (1st 5,000 / 2nd 3,000 / 3rd 2,000 USDC).
**Deadline: December 12, 2026, 11:59 PM EST** (December 13, 11:59 WIB).

Live demo: **https://dimasamirul1899-afk.github.io/indiefun-prediction-arena/**

## How it works

1. **Connect** Phantom on devnet — or use **demo mode**, which runs the whole
   flow against a mock connection with no wallet at all.
2. **Bet** YES or NO on a market (e.g. "Will SOL close above $75 by Dec 13?").
   Your SOL goes to the market's vault as a plain transfer, with an on-chain
   memo: `ARENA:v1|bet|<marketId>|YES|NO`. Anyone can audit a market on
   Solscan by scanning the vault's incoming transfers.
3. **Resolve** — after the deadline, the market settles against the SOL/USD
   price (CoinGecko, free API, no key).
4. **Get paid** — winners split the **entire pool pro-rata** by stake.
   No house fee. Every payout is a vault transaction with a Solscan link.
   If nobody bet the winning side, everyone is refunded in full.

The vault key lives in the browser that created the market (localStorage) —
this is a devnet demo with no backend. After settlement the vault key can be
exported and published so anyone can verify the vault emptied exactly.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the full protocol and its honest
trust assumptions.

## Run it

```bash
# Demo (static site, no build step)
python3 -m http.server -d docs
# open http://localhost:8000

# Tests (Node stdlib only, no dependencies)
node --test test/arena.test.js

# Full lifecycle simulation (create -> bet -> resolve -> settle)
node scripts/simulate-flow.mjs

# Devnet verification (needs network; no funds needed)
npm install
node scripts/verify-devnet.mjs
```

## Verification status (honest)

- `node --test test/arena.test.js` — **9/9 pass**: memo codec, outcome rules,
  market validation, parimutuel settlement incl. dust and refund paths.
- `node scripts/simulate-flow.mjs` — full lifecycle simulation passes; a
  1.00 SOL pool settles exactly (winners get 0.76923077 + 0.23076923 SOL).
- `node scripts/verify-devnet.mjs` — **9/9 checks pass against live devnet**:
  RPC reachable, memo program exists and is executable, the exact bet
  transaction the app builds decodes back to a system transfer + the exact
  memo, simulation reaches the runtime (fails only on the unfunded throwaway
  fee payer), and the memo program has real on-chain history on devnet.
- **Not yet done:** a funded live bet transaction. The RPC airdrop endpoint
  is closed on devnet (`410 Gone` — "request test SOL at
  https://faucet.solana.com"), and the web faucet needs a browser. One-minute
  browser step: fund any wallet at https://faucet.solana.com, connect it to
  the demo, place a bet — the transaction + memo will appear on Solscan
  devnet. No custom on-chain program is used (System Program + Memo Program
  only), so there is no program to deploy.

## Tech

- Static site, zero build step, zero backend. `@solana/web3.js` from CDN.
- Pure-logic module `docs/arena.js` shared by the browser app and the Node
  test suite — the settlement math the UI runs is the math the tests prove.
- All money math in integer lamports. No API keys, no real money, devnet only.

## Submission

See [SUBMISSION.md](SUBMISSION.md) for the exact steps Bung Asta takes to
submit (Indie.fun project page, video trailer, Superteam Earn submission).

## License

MIT.
