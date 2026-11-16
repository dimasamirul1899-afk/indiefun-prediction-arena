// app.js — SolPredict Arena browser app.
// Live mode: Phantom wallet + Solana devnet, real SOL transfers + memo.
// Demo mode: same code paths against a mock connection, deterministic fake
// signatures — the whole flow works with no wallet at all.
// Pure market math lives in arena.js (shared with the Node test suite).

import * as Arena from './arena.js';

const MEMO_PROGRAM_ID_STR = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const STORE_KEY = 'solpredict-arena-v1';
const SOLSCAN = 'https://explorer.solana.com';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
const FEE_PER_PAYOUT = 5000; // lamports, paid by the vault per payout tx

let W = null; // window.solanaWeb3, once the CDN script loads
let connection = null;
let wallet = null; // { publicKey } — Phantom or mock
let demoMode = false;
let solPrice = null;
const selectedAmount = {}; // marketId -> SOL amount

// --- tiny base58 (for mock addresses in demo mode; no dependency) --------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  let leading = 0;
  for (const b of bytes) { if (b === 0) leading++; else break; }
  return '1'.repeat(leading) + (out || '1');
}
function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// --- mock connection + wallet (demo mode) ---------------------------------
let mockCounter = 0;
const mockVaultBalances = {}; // marketId -> lamports (demo mode)
class MockConnection {
  async getBalance() { return 10 * Arena.LAMPORTS_PER_SOL; }
  async getLatestBlockhash() { return { blockhash: 'DemoBlockhash111111111111111111111111111111', lastValidBlockHeight: 999999 }; }
  async sendRawTransaction(serialized) {
    mockCounter++;
    return 'demo' + fnv1a(serialized.toString() + mockCounter) + fnv1a('sig' + mockCounter);
  }
  async confirmTransaction() { return { value: { err: null } }; }
}
const mockWallet = {
  publicKey: { toBase58: () => 'DemoWallet1111111111111111111111111111111111' },
};

// --- state ------------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted store: reseed */ }
  return { markets: [], bets: [], vaultSecrets: {}, activity: [] };
}
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
let state = loadState();

function makeVault() {
  if (W && !demoMode) {
    const kp = W.Keypair.generate();
    return { pubkey: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) };
  }
  const pub = base58Encode(randomBytes(32));
  return { pubkey: pub, secret: Array.from(randomBytes(64)) };
}

function seedMarkets() {
  if (state.markets.length > 0) return;
  const seeds = [
    { id: 'sol-75-dec13', question: 'Will SOL close above $75 by Dec 13, 2026?', targetPrice: 75, direction: 'above', deadline: Date.parse('2026-12-13T11:59:00+07:00') },
    { id: 'sol-100-jan01', question: 'Will SOL close above $100 by Jan 1, 2027?', targetPrice: 100, direction: 'above', deadline: Date.parse('2027-01-01T00:00:00+07:00') },
    { id: 'sol-60-dec01', question: 'Will SOL close below $60 by Dec 1, 2026?', targetPrice: 60, direction: 'below', deadline: Date.parse('2026-12-01T00:00:00+07:00') },
  ];
  const creator = wallet ? wallet.publicKey.toBase58() : 'DemoWallet1111111111111111111111111111111111';
  for (const s of seeds) {
    const v = makeVault();
    state.markets.push({ ...s, vault: v.pubkey, creator, status: 'open', outcome: null, settlePrice: null, settledAt: null });
    state.vaultSecrets[s.id] = v.secret;
    mockVaultBalances[s.id] = 0;
  }
  saveState();
}

function log(text, sig) {
  state.activity.unshift({ ts: Date.now(), text, sig: sig || null, demo: demoMode });
  state.activity = state.activity.slice(0, 50);
  saveState();
  renderActivity();
}

// --- helpers ------------------------------------------------------------------
function $(id) { return document.getElementById(id); }
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4500);
}
function solscanTx(sig) { return `${SOLSCAN}/tx/${sig}?cluster=devnet`; }
function solscanAddr(addr) { return `${SOLSCAN}/address/${addr}?cluster=devnet`; }
function short(addr) { return addr.slice(0, 4) + '…' + addr.slice(-4); }
function fmtSol(lamports) { return (lamports / Arena.LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '') + ' SOL'; }
function fmtCountdown(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return 'deadline passed';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
async function fetchSolPrice() {
  try {
    const r = await fetch(COINGECKO_URL);
    const j = await r.json();
    solPrice = j.solana.usd;
    $('solPrice').textContent = '$' + solPrice;
  } catch {
    $('solPrice').textContent = 'unavailable';
  }
}

async function getVaultBalance(market) {
  if (demoMode) return mockVaultBalances[market.id] || 0;
  if (!W || !connection) return null;
  try {
    return await connection.getBalance(new W.PublicKey(market.vault));
  } catch { return null; }
}

// --- flows --------------------------------------------------------------------
async function placeBet(marketId, side) {
  const market = state.markets.find((m) => m.id === marketId);
  if (!market || market.status !== 'open') return toast('Market is not open.');
  if (!wallet) return toast(demoMode ? 'Demo wallet missing.' : 'Connect Phantom first — or switch to demo mode.');
  const amountSol = selectedAmount[marketId] || 0.1;
  let lamports;
  try { lamports = Arena.solToLamports(amountSol); } catch (e) { return toast(e.message); }

  const memo = Arena.encodeBetMemo(market.id, side);
  let sig;
  if (demoMode) {
    mockCounter++;
    sig = 'demo' + fnv1a(memo + market.id + mockCounter) + fnv1a('bet' + mockCounter);
    mockVaultBalances[market.id] = (mockVaultBalances[market.id] || 0) + lamports;
  } else {
    try {
      const tx = new W.Transaction().add(
        W.SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new W.PublicKey(market.vault), lamports }),
        new W.TransactionInstruction({ keys: [], programId: new W.PublicKey(MEMO_PROGRAM_ID_STR), data: new TextEncoder().encode(memo) }),
      );
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await window.solana.signTransaction(tx);
      sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');
    } catch (e) {
      console.error(e);
      return toast('Transaction failed: ' + (e.message || e));
    }
  }
  state.bets.push({ marketId, bettor: wallet.publicKey.toBase58(), side, lamports, signature: sig, ts: Date.now(), demo: demoMode });
  saveState();
  log(`Bet ${fmtSol(lamports)} on ${side} — “${market.question}”`, sig);
  toast(`Bet placed: ${fmtSol(lamports)} on ${side}. ${demoMode ? '(demo, simulated)' : 'On-chain ✓'}`);
  renderMarkets();
}

async function closeMarket(marketId) {
  const market = state.markets.find((m) => m.id === marketId);
  if (!market || market.status !== 'open') return;
  if (Date.now() < market.deadline) return toast('Deadline has not passed yet.');
  let price = solPrice;
  if (price == null) {
    await fetchSolPrice();
    price = solPrice;
  }
  if (price == null) {
    const manual = Number(prompt('CoinGecko is unreachable. Enter the SOL/USD settlement price manually:'));
    if (!Number.isFinite(manual) || manual <= 0) return toast('Invalid price.');
    price = manual;
  }
  const outcome = Arena.deriveOutcome(market, price);
  market.status = 'resolved';
  market.outcome = outcome;
  market.settlePrice = price;
  saveState();
  log(`Market resolved ${outcome} at $${price} — “${market.question}”`, null);
  toast(`Resolved: ${outcome} wins at $${price}.`);
  renderMarkets();
}

async function settleMarket(marketId) {
  const market = state.markets.find((m) => m.id === marketId);
  if (!market || market.status !== 'resolved') return;
  const secret = state.vaultSecrets[marketId];
  if (!secret) return toast('This browser does not hold the vault key for this market — only the vault holder can settle.');
  const bets = state.bets.filter((b) => b.marketId === marketId);
  const payouts = Arena.computePayouts(bets, market.outcome);
  const nonzero = payouts.filter((p) => p.payout > 0);
  if (nonzero.length === 0) {
    market.status = 'settled';
    market.settledAt = Date.now();
    saveState();
    log(`Settled (no winners to pay) — “${market.question}”`, null);
    return renderMarkets();
  }
  const feeReserve = nonzero.length * FEE_PER_PAYOUT;
  const largest = nonzero.reduce((a, b) => (b.payout >= a.payout ? b : a));
  if (largest.payout <= feeReserve) {
    return toast('Pool is too small to cover payout fees — fund the vault with a little extra devnet SOL first.');
  }
  largest.payout -= feeReserve;

  const paid = [];
  for (const p of nonzero) {
    let sig;
    if (demoMode) {
      mockCounter++;
      sig = 'demo' + fnv1a('pay' + market.id + p.bettor + mockCounter) + fnv1a('settle' + mockCounter);
      mockVaultBalances[market.id] = Math.max(0, (mockVaultBalances[market.id] || 0) - p.payout - FEE_PER_PAYOUT);
    } else {
      try {
        const vaultKp = W.Keypair.fromSecretKey(Uint8Array.from(secret));
        const tx = new W.Transaction().add(
          W.SystemProgram.transfer({ fromPubkey: vaultKp.publicKey, toPubkey: new W.PublicKey(p.bettor), lamports: p.payout }),
        );
        tx.feePayer = vaultKp.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(vaultKp);
        sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig, 'confirmed');
      } catch (e) {
        console.error(e);
        toast('Payout failed for ' + short(p.bettor) + ': ' + (e.message || e));
        continue;
      }
    }
    paid.push({ ...p, sig });
    log(`Paid ${fmtSol(p.payout)} to ${short(p.bettor)}${p.refunded ? ' (refund)' : ''} — “${market.question}”`, sig);
  }
  market.status = 'settled';
  market.settledAt = Date.now();
  saveState();
  toast(`Settled: ${paid.length} payout(s) sent. Vault emptied.`);
  renderMarkets();
}

function createMarket() {
  const question = $('fQuestion').value.trim();
  const targetPrice = Number($('fTarget').value);
  const direction = $('fDirection').value;
  const deadline = Date.parse($('fDeadline').value);
  const id = 'm-' + fnv1a(question + Date.now()) + '-' + Math.floor(Math.random() * 1000);
  const v = makeVault();
  const market = {
    id, question, targetPrice, direction, deadline,
    vault: v.pubkey, creator: wallet ? wallet.publicKey.toBase58() : 'DemoWallet1111111111111111111111111111111111',
    status: 'open', outcome: null, settlePrice: null, settledAt: null,
  };
  try { Arena.validateMarket(market); } catch (e) { return toast(e.message); }
  state.markets.unshift(market);
  state.vaultSecrets[id] = v.secret;
  mockVaultBalances[id] = 0;
  saveState();
  $('createPanel').classList.add('hidden');
  log(`Market created — “${question}” (vault ${short(v.pubkey)})`, null);
  toast('Market created. Vault: ' + short(v.pubkey));
  renderMarkets();
}

// --- rendering ------------------------------------------------------------------
function marketBets(marketId) { return state.bets.filter((b) => b.marketId === marketId); }

async function renderMarkets() {
  const el = $('markets');
  if (state.markets.length === 0) { el.innerHTML = '<p class="meta">No markets yet.</p>'; return; }
  const parts = [];
  for (const m of state.markets) {
    const bets = marketBets(m.id);
    const sum = Arena.summarizeBets(bets);
    const yesPct = Math.round(Arena.impliedYesProbability(bets) * 100);
    const bal = await getVaultBalance(m);
    const amount = selectedAmount[m.id] || 0.1;
    const canSettle = m.status === 'resolved' && state.vaultSecrets[m.id];
    const statusLabel = { open: 'OPEN', closed: 'CLOSED', resolved: 'RESOLVED', settled: 'SETTLED' }[m.status];
    parts.push(`<article class="card">
      <span class="status ${m.status}">${statusLabel}</span>
      <h3>${escapeHtml(m.question)}</h3>
      <p class="meta">Target <b>$${m.targetPrice}</b> · ${m.direction === 'above' ? 'YES wins if SOL ≥ target' : 'YES wins if SOL ≤ target'} · ${fmtCountdown(m.deadline)}</p>
      <p class="meta">Vault <a href="${solscanAddr(m.vault)}" target="_blank" rel="noopener"><code>${short(m.vault)}</code></a> · on-chain balance: <b>${bal == null ? '…' : fmtSol(bal)}</b></p>
      <div class="odds"><div class="yesbar" style="width:${yesPct}%"></div></div>
      <div class="odds-labels"><span>YES <b>${yesPct}%</b> · ${fmtSol(sum.yesLamports)}</span><span>NO <b>${100 - yesPct}%</b> · ${fmtSol(sum.noLamports)}</span></div>
      <p class="meta">${bets.length} bet(s) · pool ${fmtSol(sum.totalLamports)}</p>
      ${m.outcome ? `<p class="meta">Outcome: <b>${m.outcome}</b> at $${m.settlePrice}</p>` : ''}
      ${m.status === 'open' ? `
      <div class="betrow">
        <span class="amt">${[0.05, 0.1, 0.25, 0.5].map((a) => `<button class="${amount === a ? 'sel' : ''}" onclick="__arena.amount('${m.id}', ${a})">${a} SOL</button>`).join('')}</span>
      </div>
      <div class="betrow">
        <button class="btn yes" onclick="__arena.bet('${m.id}', 'YES')">Bet YES · ${amount} SOL</button>
        <button class="btn no" onclick="__arena.bet('${m.id}', 'NO')">Bet NO · ${amount} SOL</button>
      </div>` : ''}
      ${m.status === 'open' && Date.now() >= m.deadline ? `<div class="betrow"><button class="btn" onclick="__arena.close('${m.id}')">Close &amp; resolve (fetch SOL price)</button></div>` : ''}
      ${m.status === 'resolved' ? `<div class="betrow">${canSettle ? `<button class="btn primary" onclick="__arena.settle('${m.id}')">Settle &amp; pay winners</button>` : `<span class="meta">Only the vault holder (the browser that created this market) can settle it.</span>`}</div>` : ''}
      ${m.status === 'settled' ? `<p class="meta">Settled ${new Date(m.settledAt).toLocaleString()} — vault emptied.</p>` : ''}
    </article>`);
  }
  el.innerHTML = parts.join('');
}
function renderActivity() {
  const el = $('activity');
  if (state.activity.length === 0) { el.innerHTML = '<li>No activity yet — place a bet or create a market.</li>'; return; }
  el.innerHTML = state.activity.map((a) => `<li>${escapeHtml(a.text)}${a.demo ? ' <span class="badge demo">demo</span>' : ''}${a.sig ? ` <a href="${solscanTx(a.sig)}" target="_blank" rel="noopener"><code>${a.sig.slice(0, 12)}…</code> ↗</a>` : ''} <code>${new Date(a.ts).toLocaleTimeString()}</code></li>`).join('');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- wallet / mode ---------------------------------------------------------------
async function setMode(demo) {
  demoMode = demo;
  $('demoBadge').classList.toggle('hidden', !demo);
  $('demoToggle').textContent = demo ? 'Exit demo mode' : 'Try demo mode';
  if (demo) {
    connection = new MockConnection();
    wallet = mockWallet;
    $('walletBtn').textContent = 'Demo wallet: ' + short(mockWallet.publicKey.toBase58());
    $('walletBtn').disabled = true;
    toast('Demo mode: everything is simulated, no real transactions.');
  } else {
    $('walletBtn').disabled = false;
    wallet = null;
    connection = (W && !window.__web3Failed) ? new W.Connection(W.clusterApiUrl('devnet'), 'confirmed') : null;
    $('walletBtn').textContent = 'Connect Phantom';
    if (!connection) toast('Could not load @solana/web3.js — live mode unavailable, demo mode works.');
  }
  seedMarkets();
  renderActivity();
  renderMarkets();
}

async function connectWallet() {
  if (demoMode) return;
  if (!window.solana || !window.solana.isPhantom) {
    window.open('https://phantom.app/', '_blank');
    return toast('Phantom not detected — install it, switch it to devnet, and come back.');
  }
  try {
    const res = await window.solana.connect();
    wallet = { publicKey: res.publicKey };
    $('walletBtn').textContent = short(res.publicKey.toBase58()) + ' · Connected';
    toast('Connected: ' + res.publicKey.toBase58());
    renderMarkets();
  } catch (e) {
    toast('Wallet connection cancelled.');
  }
}

// --- boot -------------------------------------------------------------------------
window.__arena = {
  bet: placeBet,
  close: closeMarket,
  settle: settleMarket,
  amount: (id, a) => { selectedAmount[id] = a; renderMarkets(); },
};

$('demoToggle').addEventListener('click', () => setMode(!demoMode));
$('walletBtn').addEventListener('click', connectWallet);
$('refreshBtn').addEventListener('click', () => { fetchSolPrice(); renderMarkets(); });
$('newMarketBtn').addEventListener('click', () => {
  $('createPanel').classList.toggle('hidden');
  const d = $('fDeadline');
  if (!d.value) {
    const t = new Date(Date.now() + 7 * 86400000);
    d.value = t.toISOString().slice(0, 16);
  }
});
$('createBtn').addEventListener('click', createMarket);

window.addEventListener('web3-ready', () => {
  W = window.solanaWeb3 || null;
  if (!demoMode && W) {
    connection = new W.Connection(W.clusterApiUrl('devnet'), 'confirmed');
  }
  seedMarkets();
  renderMarkets();
});

fetchSolPrice();
setInterval(fetchSolPrice, 60000);
// If the CDN script already loaded before this module ran, boot immediately.
if (window.solanaWeb3) {
  W = window.solanaWeb3;
  connection = new W.Connection(W.clusterApiUrl('devnet'), 'confirmed');
  seedMarkets();
  renderActivity();
  renderMarkets();
} else if (window.__web3Failed) {
  setMode(true);
}
