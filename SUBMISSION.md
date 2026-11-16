# SolPredict Arena — Submission checklist (for Bung Asta)

Bounty: **Indie.fun Hackathon — $10k+ in prizes**
Listing: https://superteam.fun/earn/listing/indiefun-hackathon-10kprize
**Deadline: December 12, 2026, 11:59 PM EST = December 13, 2026, 11:59 WIB**

## What is already done

- Repo (public, MIT): https://github.com/dimasamirul1899-afk/indiefun-prediction-arena
- Live demo: https://dimasamirul1899-afk.github.io/indiefun-prediction-arena/
- Tests: 9/9 pass (`node --test test/arena.test.js`); lifecycle simulation
  passes; devnet checks pass (see README for the honest status — a funded
  live bet still needs a browser faucet claim, 1 minute).

## Steps Bung takes

### 1. Get devnet SOL and place one real bet (1 minute, proves it live)

- Open https://faucet.solana.com, paste your Phantom devnet address, claim.
- Open the demo, connect Phantom (make sure Phantom is on **devnet**),
  place a bet on any market. The transaction + memo appear on Solscan
  devnet — link one in the submission as live proof.

### 2. Publish the project on Indie.fun (no token mint needed)

- Open https://indie.fun, connect your wallet, create the project
  "SolPredict Arena" with the GitHub repo link and the demo link.
- Copy the Indie.fun project page URL.

### 3. Record the video trailer (2–3 minutes)

Suggested shots (screen-record the demo, voice-over in English):

1. (0:00–0:20) Hook: "Prediction markets are broken — opaque odds, hidden
   fees. SolPredict Arena puts every bet on-chain." Show the hero.
2. (0:20–1:00) Connect Phantom on devnet, place a YES bet — show the
   transaction confirm and open it on Solscan, point at the memo.
3. (1:00–1:40) Create a market, show the vault address; fast-forward the
   deadline, resolve against the live SOL price, settle — show the payout
   transactions on Solscan.
4. (1:40–2:20) Demo mode: the same flow with no wallet. "Anyone can try it
   in one click."
5. (2:20–end) "Parimutuel, zero house fee, fully auditable. Built for the
   Indie.fun Hackathon." Show repo + demo links.

Post the video on X and keep the link.

### 4. Submit on Superteam Earn

Open the listing and submit these links:

- Public GitHub repo: https://github.com/dimasamirul1899-afk/indiefun-prediction-arena
- Indie.fun project page: (from step 2)
- Video trailer: (from step 3, X link)
- Project social media: your X account link

All submission content must be in English (the demo, repo, and video are).

### 5. Optional bonus (judges reward it)

- Integrate a partner's tech (Moddio / Play Solana) — not done in this
  version; only add it if there is time before the deadline.
- Share the demo on X with the hackathon hashtag and tag @indiedotfun.
