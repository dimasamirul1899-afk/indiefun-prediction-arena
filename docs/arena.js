// arena.js — pure prediction-market logic for SolPredict Arena.
// No DOM, no network, no dependencies. Shared by the browser app
// (docs/app.js) and the Node test suite (test/arena.test.js).
// All money math is integer lamports; 1 SOL = 1_000_000_000 lamports.

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const MEMO_PREFIX = 'ARENA';
export const MEMO_VERSION = 'v1';
export const MIN_BET_LAMPORTS = 10_000_000; // 0.01 SOL
export const MAX_BET_LAMPORTS = 500_000_000; // 0.5 SOL
export const HOUSE_FEE_BPS = 0; // no fee: winners split the whole pool

export function solToLamports(sol) {
  if (typeof sol !== 'number' || !Number.isFinite(sol) || sol <= 0) {
    throw new Error('amount must be a positive number');
  }
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  if (lamports < MIN_BET_LAMPORTS) throw new Error('bet below minimum 0.01 SOL');
  if (lamports > MAX_BET_LAMPORTS) throw new Error('bet above maximum 0.5 SOL');
  return lamports;
}

export function lamportsToSol(lamports) {
  return lamports / LAMPORTS_PER_SOL;
}

// --- Memo codec -----------------------------------------------------------
// Bets are real on-chain transfers to the market vault with a memo:
//   ARENA:v1|bet|<marketId>|<YES|NO>
// Anyone can audit a market by scanning the vault's incoming transfers.

export function encodeBetMemo(marketId, side) {
  if (typeof marketId !== 'string' || !/^[a-z0-9-]{3,32}$/.test(marketId)) {
    throw new Error('invalid marketId');
  }
  if (side !== 'YES' && side !== 'NO') throw new Error('side must be YES or NO');
  return `${MEMO_PREFIX}:${MEMO_VERSION}|bet|${marketId}|${side}`;
}

export function parseBetMemo(memo) {
  if (typeof memo !== 'string') return null;
  const parts = memo.split('|');
  if (parts.length !== 4) return null;
  if (parts[0] !== `${MEMO_PREFIX}:${MEMO_VERSION}`) return null;
  if (parts[1] !== 'bet') return null;
  const marketId = parts[2];
  const side = parts[3];
  if (!/^[a-z0-9-]{3,32}$/.test(marketId)) return null;
  if (side !== 'YES' && side !== 'NO') return null;
  return { marketId, side };
}

// --- Market outcome -------------------------------------------------------

export function deriveOutcome(market, priceAtClose) {
  if (typeof priceAtClose !== 'number' || !Number.isFinite(priceAtClose) || priceAtClose <= 0) {
    throw new Error('invalid settlement price');
  }
  if (market.direction === 'above') return priceAtClose >= market.targetPrice ? 'YES' : 'NO';
  if (market.direction === 'below') return priceAtClose <= market.targetPrice ? 'YES' : 'NO';
  throw new Error('market.direction must be above or below');
}

export function validateMarket(m) {
  if (!m || typeof m !== 'object') throw new Error('market must be an object');
  if (typeof m.id !== 'string' || !/^[a-z0-9-]{3,32}$/.test(m.id)) throw new Error('invalid market id');
  if (typeof m.question !== 'string' || m.question.trim().length < 10 || m.question.length > 140) {
    throw new Error('question must be 10-140 characters');
  }
  if (typeof m.targetPrice !== 'number' || !Number.isFinite(m.targetPrice) || m.targetPrice <= 0) {
    throw new Error('targetPrice must be a positive number');
  }
  if (m.direction !== 'above' && m.direction !== 'below') throw new Error('direction must be above or below');
  if (typeof m.deadline !== 'number' || !Number.isFinite(m.deadline) || m.deadline <= Date.now()) {
    throw new Error('deadline must be a future timestamp');
  }
  if (typeof m.vault !== 'string' || m.vault.length < 32) throw new Error('vault must be a Solana address');
  if (typeof m.creator !== 'string' || m.creator.length < 32) throw new Error('creator must be a Solana address');
  return true;
}

// --- Parimutuel settlement -------------------------------------------------
// bets: [{ bettor, side: 'YES'|'NO', lamports }]
// outcome: 'YES' | 'NO'
// Winners split the ENTIRE pool pro-rata by stake (no house fee).
// If nobody bet the winning side, every bettor is refunded in full
// (the pool cannot be paid to anyone, so it goes back).

export function summarizeBets(bets) {
  let yesLamports = 0;
  let noLamports = 0;
  for (const b of bets) {
    if (b.side === 'YES') yesLamports += b.lamports;
    else if (b.side === 'NO') noLamports += b.lamports;
    else throw new Error('bet side must be YES or NO');
  }
  return { yesLamports, noLamports, totalLamports: yesLamports + noLamports, count: bets.length };
}

export function computePayouts(bets, outcome) {
  if (outcome !== 'YES' && outcome !== 'NO') throw new Error('outcome must be YES or NO');
  const { yesLamports, noLamports, totalLamports } = summarizeBets(bets);
  if (bets.length === 0 || totalLamports === 0) return [];
  const winningLamports = outcome === 'YES' ? yesLamports : noLamports;

  // Nobody bet the winning side: full refund to every bettor.
  if (winningLamports === 0) {
    return bets.map((b) => ({ bettor: b.bettor, stake: b.lamports, payout: b.lamports, refunded: true }));
  }

  // Parimutuel: payout_i = stake_i * totalPool / winningPool (integer math,
  // remainder lamports from flooring go to the largest winner so the vault
  // always empties exactly).
  const payouts = [];
  let distributed = 0;
  for (const b of bets) {
    if (b.side !== outcome) {
      payouts.push({ bettor: b.bettor, stake: b.lamports, payout: 0, refunded: false });
      continue;
    }
    const payout = Math.floor((b.lamports * totalLamports) / winningLamports);
    payouts.push({ bettor: b.bettor, stake: b.lamports, payout, refunded: false });
    distributed += payout;
  }
  const remainder = totalLamports - distributed;
  if (remainder > 0) {
    // Give the dust to the largest winner (first one wins ties).
    let idx = -1;
    let best = -1;
    payouts.forEach((p, i) => {
      if (p.payout > best) { best = p.payout; idx = i; }
    });
    if (idx >= 0) payouts[idx].payout += remainder;
  }
  return payouts;
}

// Implied probability of YES from the current pool (for the UI odds display).
export function impliedYesProbability(bets) {
  const { yesLamports, noLamports, totalLamports } = summarizeBets(bets);
  if (totalLamports === 0) return 0.5;
  return yesLamports / totalLamports;
}
