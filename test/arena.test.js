// test/arena.test.js — pure-logic tests for SolPredict Arena.
// Run: node --test test/
// No dependencies, Node stdlib only.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solToLamports,
  lamportsToSol,
  encodeBetMemo,
  parseBetMemo,
  deriveOutcome,
  validateMarket,
  summarizeBets,
  computePayouts,
  impliedYesProbability,
} from '../docs/arena.js';

const MARKET = {
  id: 'sol-75-dec13',
  question: 'Will SOL close above $75 by Dec 13, 2026?',
  targetPrice: 75,
  direction: 'above',
  deadline: Date.now() + 1000 * 60 * 60 * 24,
  vault: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
  creator: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
};

test('solToLamports converts and enforces min/max', () => {
  assert.equal(solToLamports(0.1), 100_000_000);
  assert.equal(solToLamports(0.5), 500_000_000);
  assert.equal(lamportsToSol(250_000_000), 0.25);
  assert.throws(() => solToLamports(0.005), /minimum/);
  assert.throws(() => solToLamports(1), /maximum/);
  assert.throws(() => solToLamports(0), /positive/);
  assert.throws(() => solToLamports(NaN), /positive/);
});

test('bet memo round-trips and rejects garbage', () => {
  const memo = encodeBetMemo('sol-75-dec13', 'YES');
  assert.equal(memo, 'ARENA:v1|bet|sol-75-dec13|YES');
  assert.deepEqual(parseBetMemo(memo), { marketId: 'sol-75-dec13', side: 'YES' });
  assert.equal(parseBetMemo('ARENA:v1|bet|sol-75-dec13|MAYBE'), null);
  assert.equal(parseBetMemo('hello world'), null);
  assert.equal(parseBetMemo('ARENA:v1|bet|BAD ID!|YES'), null);
  assert.equal(parseBetMemo(null), null);
  assert.throws(() => encodeBetMemo('BAD ID!', 'YES'), /invalid marketId/);
  assert.throws(() => encodeBetMemo('ok-id', 'MAYBE'), /YES or NO/);
});

test('deriveOutcome respects direction and boundary', () => {
  assert.equal(deriveOutcome(MARKET, 75), 'YES'); // at target counts as YES
  assert.equal(deriveOutcome(MARKET, 74.99), 'NO');
  assert.equal(deriveOutcome(MARKET, 120), 'YES');
  const below = { ...MARKET, direction: 'below', targetPrice: 60 };
  assert.equal(deriveOutcome(below, 60), 'YES');
  assert.equal(deriveOutcome(below, 60.01), 'NO');
  assert.throws(() => deriveOutcome(MARKET, -1), /invalid settlement price/);
  assert.throws(() => deriveOutcome({ ...MARKET, direction: 'sideways' }, 80), /above or below/);
});

test('validateMarket accepts a good market and rejects bad ones', () => {
  assert.equal(validateMarket(MARKET), true);
  assert.throws(() => validateMarket({ ...MARKET, question: 'short' }), /10-140/);
  assert.throws(() => validateMarket({ ...MARKET, deadline: Date.now() - 1000 }), /future timestamp/);
  assert.throws(() => validateMarket({ ...MARKET, targetPrice: 0 }), /positive number/);
  assert.throws(() => validateMarket({ ...MARKET, vault: 'short' }), /Solana address/);
});

test('summarizeBets totals both sides', () => {
  const bets = [
    { bettor: 'A', side: 'YES', lamports: 100_000_000 },
    { bettor: 'B', side: 'YES', lamports: 50_000_000 },
    { bettor: 'C', side: 'NO', lamports: 150_000_000 },
  ];
  assert.deepEqual(summarizeBets(bets), { yesLamports: 150_000_000, noLamports: 150_000_000, totalLamports: 300_000_000, count: 3 });
  assert.deepEqual(summarizeBets([]), { yesLamports: 0, noLamports: 0, totalLamports: 0, count: 0 });
});

test('computePayouts splits the pool pro-rata, vault empties exactly', () => {
  // YES pool 0.15, NO pool 0.15, total 0.30. YES wins: each YES bettor doubles.
  const bets = [
    { bettor: 'A', side: 'YES', lamports: 100_000_000 },
    { bettor: 'B', side: 'YES', lamports: 50_000_000 },
    { bettor: 'C', side: 'NO', lamports: 150_000_000 },
  ];
  const payouts = computePayouts(bets, 'YES');
  assert.deepEqual(payouts, [
    { bettor: 'A', stake: 100_000_000, payout: 200_000_000, refunded: false },
    { bettor: 'B', stake: 50_000_000, payout: 100_000_000, refunded: false },
    { bettor: 'C', stake: 150_000_000, payout: 0, refunded: false },
  ]);
  const distributed = payouts.reduce((s, p) => s + p.payout, 0);
  assert.equal(distributed, 300_000_000); // vault empties exactly
});

test('computePayouts handles uneven splits with dust to the largest winner', () => {
  // YES 0.10 (one bettor), NO 0.20 (two bettors 0.10 each). NO wins: each NO bettor gets 0.15.
  const bets = [
    { bettor: 'A', side: 'YES', lamports: 100_000_000 },
    { bettor: 'B', side: 'NO', lamports: 100_000_000 },
    { bettor: 'C', side: 'NO', lamports: 100_000_000 },
  ];
  const payouts = computePayouts(bets, 'NO');
  const distributed = payouts.reduce((s, p) => s + p.payout, 0);
  assert.equal(distributed, 300_000_000);
  assert.equal(payouts.find((p) => p.bettor === 'B').payout, 150_000_000);
  assert.equal(payouts.find((p) => p.bettor === 'C').payout, 150_000_000);
  assert.equal(payouts.find((p) => p.bettor === 'A').payout, 0);

  // Odd lamports: 1 lamport YES vs 2 lamports NO, NO wins -> floor(2*3/2)=3, 3 total.
  const tiny = [
    { bettor: 'A', side: 'YES', lamports: 1 },
    { bettor: 'B', side: 'NO', lamports: 2 },
  ];
  const tinyOut = computePayouts(tiny, 'NO');
  assert.equal(tinyOut.reduce((s, p) => s + p.payout, 0), 3);
});

test('computePayouts refunds everyone when nobody bet the winning side', () => {
  const bets = [
    { bettor: 'A', side: 'NO', lamports: 100_000_000 },
    { bettor: 'B', side: 'NO', lamports: 200_000_000 },
  ];
  const payouts = computePayouts(bets, 'YES');
  assert.deepEqual(payouts, [
    { bettor: 'A', stake: 100_000_000, payout: 100_000_000, refunded: true },
    { bettor: 'B', stake: 200_000_000, payout: 200_000_000, refunded: true },
  ]);
  assert.deepEqual(computePayouts([], 'YES'), []);
});

test('impliedYesProbability is 0.5 on an empty pool', () => {
  assert.equal(impliedYesProbability([]), 0.5);
  const bets = [
    { bettor: 'A', side: 'YES', lamports: 300_000_000 },
    { bettor: 'B', side: 'NO', lamports: 100_000_000 },
  ];
  assert.equal(impliedYesProbability(bets), 0.75);
});
