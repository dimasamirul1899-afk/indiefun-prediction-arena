// scripts/verify-devnet.mjs — devnet verification of the exact bet
// transaction the app builds (transfer + memo to a market vault).
//
// NOTE: the RPC airdrop endpoint is closed on devnet ("410 Gone — request
// test SOL at https://faucet.solana.com"), and the web faucet needs a
// browser. So this script verifies everything that can be verified WITHOUT
// funds, and leaves the funded live bet as a 1-minute browser step
// (see README / SUBMISSION.md). It exits non-zero on any failed check.
//
// Run: node scripts/verify-devnet.mjs

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, clusterApiUrl, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

// 0. Chain is reachable.
const slot = await connection.getSlot();
check('devnet RPC reachable', Number.isInteger(slot) && slot > 0, `slot=${slot}`);
const blockhash = (await connection.getLatestBlockhash()).blockhash;
check('recent blockhash fetched', typeof blockhash === 'string' && blockhash.length > 30);

// 1. Memo program exists on devnet and is executable.
const memoInfo = await connection.getAccountInfo(MEMO_PROGRAM_ID);
check('memo program exists on devnet', !!memoInfo, memoInfo ? `executable=${memoInfo.executable}` : 'missing');
check('memo program is executable', memoInfo?.executable === true);

// 2. Build the EXACT bet transaction the app builds, sign it, decode it back.
const bettor = Keypair.generate();
const vault = Keypair.generate();
const MEMO = 'ARENA:v1|bet|sol-75-dec13|YES';
const BET = 0.1 * LAMPORTS_PER_SOL;
const tx = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: bettor.publicKey, toPubkey: vault.publicKey, lamports: BET }),
  new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: new TextEncoder().encode(MEMO) }),
);
tx.feePayer = bettor.publicKey;
tx.recentBlockhash = blockhash;
tx.sign(bettor);
const serialized = tx.serialize();
const decoded = Transaction.from(serialized);
check('tx has exactly 2 instructions', decoded.instructions.length === 2, `got ${decoded.instructions.length}`);
const [t0, t1] = decoded.instructions;
check('ix0 is a system transfer to the vault',
  t0.programId.equals(SystemProgram.programId) &&
  t0.keys[0].pubkey.equals(bettor.publicKey) &&
  t0.keys[1].pubkey.equals(vault.publicKey) &&
  Number(t0.data.readBigUInt64LE(4)) === BET);
check('ix1 is a memo with the exact bet memo',
  t1.programId.equals(MEMO_PROGRAM_ID) &&
  new TextDecoder().decode(t1.data) === MEMO, JSON.stringify(new TextDecoder().decode(t1.data)));

// 3. Simulate against the live chain: it must fail ONLY on funds
// (bettor is unfunded), proving the tx is well-formed and reaches the runtime.
const sim = await connection.simulateTransaction(decoded);
const simErr = sim.value.err;
const simErrStr = JSON.stringify(simErr);
const isFundsError = simErrStr.includes('InsufficientFunds') ||
  simErrStr.includes('InvalidAccountForFee') || // unfunded fee payer: account does not exist yet
  (typeof sim.value.logs?.join(' ') === 'string' && sim.value.logs.join(' ').includes('insufficient'));
check('simulation reaches the runtime (fails only on unfunded bettor)',
  isFundsError, `err=${JSON.stringify(simErr)}`);

// 4. A real on-chain memo transaction exists on devnet (mechanism proven live).
const sigs = await connection.getSignaturesForAddress(MEMO_PROGRAM_ID, { limit: 1 });
check('memo program has on-chain history on devnet', sigs.length > 0, sigs[0]?.signature ?? 'none');
if (sigs.length > 0) {
  console.log(`    e.g. https://explorer.solana.com/tx/${sigs[0].signature}?cluster=devnet`);
}

console.log('');
if (failures.length > 0) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('DEVNET VERIFIED (no funds needed for these checks)');
console.log('  Remaining live step (browser, 1 min): fund any wallet at');
console.log('  https://faucet.solana.com, place a bet in the demo, and the');
console.log('  transaction + memo will appear on Solscan devnet.');
