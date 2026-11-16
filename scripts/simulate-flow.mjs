// scripts/simulate-flow.mjs — end-to-end lifecycle simulation of the Arena
// protocol using only arena.js (no network, no wallet).
// Run: node scripts/simulate-flow.mjs
// Verifies: market validation, memo audit trail, parimutuel settlement,
// vault empties exactly, refund path.

import assert from 'node:assert/strict';
import {
  solToLamports, encodeBetMemo, parseBetMemo, deriveOutcome,
  validateMarket, summarizeBets, computePayouts,
} from '../docs/arena.js';

const market = {
  id: 'sol-75-dec13',
  question: 'Will SOL close above $75 by Dec 13, 2026?',
  targetPrice: 75,
  direction: 'above',
  deadline: Date.now() + 86400000,
  vault: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
  creator: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
};
assert.equal(validateMarket(market), true);

// Three bettors, mixed sides. Memos are the on-chain audit trail.
const rawBets = [
  { bettor: 'Alice11111111111111111111111111111111111', side: 'YES', sol: 0.25 },
  { bettor: 'Bob2222222222222222222222222222222222222', side: 'YES', sol: 0.10 },
  { bettor: 'Carol33333333333333333333333333333333333', side: 'NO', sol: 0.50 },
  { bettor: 'Dave444444444444444444444444444444444444', side: 'NO', sol: 0.15 },
];
const bets = rawBets.map((b) => {
  const memo = encodeBetMemo(market.id, b.side);
  const parsed = parseBetMemo(memo);
  assert.deepEqual(parsed, { marketId: market.id, side: b.side });
  return { bettor: b.bettor, side: b.side, lamports: solToLamports(b.sol), memo };
});
const pool = summarizeBets(bets);
assert.equal(pool.totalLamports, 1_000_000_000); // 1.00 SOL total
assert.equal(pool.yesLamports, 350_000_000);
assert.equal(pool.noLamports, 650_000_000);

// Close: SOL at $71.88 -> below target -> NO wins.
const outcome = deriveOutcome(market, 71.88);
assert.equal(outcome, 'NO');
const payouts = computePayouts(bets, outcome);
const distributed = payouts.reduce((s, p) => s + p.payout, 0);
assert.equal(distributed, pool.totalLamports, 'vault must empty exactly');
const carol = payouts.find((p) => p.bettor.startsWith('Carol'));
const dave = payouts.find((p) => p.bettor.startsWith('Dave'));
assert.equal(carol.payout, 769_230_770); // 0.50 * 1.00 / 0.65, floored, + 1 lamport dust
assert.equal(dave.payout, 230_769_230); // 0.15 * 1.00 / 0.65, floored
assert.equal(payouts.find((p) => p.bettor.startsWith('Alice')).payout, 0);

// Refund path: market where nobody bet the winning side.
const oneSided = [{ bettor: 'Eve', side: 'NO', lamports: 200_000_000 }];
const refund = computePayouts(oneSided, 'YES');
assert.equal(refund[0].payout, 200_000_000);
assert.equal(refund[0].refunded, true);

console.log('SIMULATION OK');
console.log(`  pool: 1.00 SOL (YES 0.35 / NO 0.65), price $71.88 -> NO wins`);
console.log(`  Carol 0.50 -> ${carol.payout / 1e9} SOL, Dave 0.15 -> ${dave.payout / 1e9} SOL, Alice/Bob -> 0`);
console.log(`  vault empties exactly: distributed ${distributed / 1e9} SOL`);
