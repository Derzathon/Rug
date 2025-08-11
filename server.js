import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocket } from 'ws';

/**
 * server.js — RPC logs v3b (BUY = +MINT for a SIGNER and SOL lamports decrease)
 * - Classifies by the **signer’s** deltas: +base token AND native SOL (lamports) decrease
 * - Avoids temp program accounts / routers by focusing on tx signers only
 * - Stable WS handling from v3 (debounced reconnects)
 */

const BUILD_TAG = 'RPC-logs v3b';
const PORT = process.env.PORT || 3000;
const MINT = process.env.MINT;
const RPC_WS  = process.env.RPC_WS  || 'wss://api.mainnet-beta.solana.com';
const RPC_HTTP = process.env.RPC_HTTP || 'https://api.mainnet-beta.solana.com';

if (!MINT) { console.error('❌ Missing MINT in .env'); process.exit(1); }

// ---------- Express/SSE ----------
const app = express();
app.use(cors());
app.use(express.static('public'));

let clients = [];
let lastMC = 0;
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello', message: 'connected', build: BUILD_TAG })}\n\n`);
  if (lastMC && Number(lastMC) > 0) {
    res.write(`data: ${JSON.stringify({ type: 'marketcap', mc: lastMC })}\n\n`);
  }
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});
function broadcast(data) { const payload = `data: ${JSON.stringify(data)}\n\n`; clients.forEach(c => c.write(payload)); }

app.get('/overlay', (req, res) => res.sendFile(process.cwd() + '/public/overlay/index.html'));
app.get('/health', (req, res) => res.json({ ok: true, pairAddress, priceNative, lastMC, build: BUILD_TAG }));
app.get('/debug/fake-buy', (req, res) => {
  const amt = Number(req.query.sol || '1');
  const level = levelFor(amt);
  if (level > 0) broadcast({ type: 'buy', amountSol: amt, wallet: 'FAKE_WALLET_TEST', level, txHash: null, src: 'debug' });
  res.json({ ok: true });
});

// ---------- Thresholds ----------
function levelFor(amountSol) {
  if (amountSol < 0.1) return 0;
  if (amountSol < 0.5) return 1;
  if (amountSol < 1)   return 2;
  if (amountSol < 5)   return 3;
  if (amountSol < 10)  return 4;
  return 5;
}

// ---------- Helpers ----------
async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}: ${txt}`);
  }
  return await r.json();
}
async function rpc(method, params) {
  const r = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${j.error.message}`);
  return j.result;
}

// ---------- Dexscreener (pair + price + MC) ----------
let pairAddress = null;
let priceNative = 0;
let hadSocket = false;

async function refreshDex() {
  try {
    const url = `https://api.dexscreener.com/token-pairs/v1/solana/${MINT}`;
    const pairs = await fetchJson(url);
    if (!Array.isArray(pairs) || !pairs.length) return;
    // Prefer SOL-quoted
    let best = null;
    for (const p of pairs) {
      const isSolQuote = ((p?.quoteToken?.symbol||'').toUpperCase()==='SOL') ||
                         (p?.quoteToken?.address==='So11111111111111111111111111111111111111112');
      if (!isSolQuote) continue;
      if (!best || (p?.liquidity?.usd||0) > (best?.liquidity?.usd||0)) best = p;
    }
    if (!best) best = pairs.sort((a,b)=>(b?.liquidity?.usd||0)-(a?.liquidity?.usd||0))[0];

    const nextPair = best?.pairAddress || pairAddress;
    const nextPrice = Number(best?.priceNative || 0) || priceNative;
    const mc = best?.marketCap || best?.fdv || 0;

    const changed = nextPair && nextPair !== pairAddress;
    pairAddress = nextPair;
    priceNative = nextPrice;
    if (mc && mc !== lastMC) { lastMC = mc; broadcast({ type: 'marketcap', mc }); }
    if (changed && hadSocket) {
      console.log('[DEX] Pair changed → scheduling reconnect');
      scheduleReconnect(0);
    } else if (changed) {
      console.log('[DEX] Using pair:', pairAddress, 'quote:', best?.quoteToken?.symbol);
    }
  } catch (e) {
    console.error('[DEX] Error:', e.message);
  }
}
setInterval(() => { if (lastMC) broadcast({ type: 'marketcap', mc: lastMC }); }, 30_000);

// ---------- WS logsSubscribe (stable) ----------
let ws = null;
let wsSubId = null;
let seenSig = new Set();
let isConnecting = false;
let reconnectTimer = null;

function scheduleReconnect(delayMs = 5000) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(true); }, delayMs);
}
function connectWS(force = false) {
  if (!pairAddress) return;
  if (isConnecting && !force) return;
  isConnecting = true;

  try { if (ws) ws.close(); } catch {}
  ws = null; wsSubId = null;

  const socket = new WebSocket(RPC_WS);

  socket.onopen = () => {
    const msg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [{ mentions: [pairAddress] }, { commitment: 'confirmed' }]
    };
    try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); } catch {}
    isConnecting = false;
    hadSocket = true;
  };

  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data?.result && data?.id === 1) {
        wsSubId = data.result;
        console.log('[WS] logsSubscribe OK. subId:', wsSubId);
      } else if (data?.method === 'logsNotification') {
        const sig = data?.params?.result?.value?.signature;
        if (!sig || seenSig.has(sig)) return;
        seenSig.add(sig);
        handleSignature(sig).catch(()=>{});
      }
    } catch {}
  };

  socket.onclose = () => {
    console.warn('[WS] closed, reconnecting...');
    isConnecting = false;
    wsSubId = null;
    scheduleReconnect(5000);
  };

  socket.onerror = (e) => {
    console.error('[WS] error', e?.message || e);
    try { socket.close(); } catch {}
  };

  ws = socket; // assign at end to avoid races
}

// ---------- Buy-only via signer deltas ----------
function buildBaseDeltaByOwner(preTB = [], postTB = [], mint) {
  // map owner -> net delta of base token
  const m = new Map();
  for (const b of preTB) {
    if (b.mint !== mint) continue;
    const owner = b.owner ?? b.accountIndex;
    const amt = Number(b.uiTokenAmount?.uiAmount || 0);
    m.set(owner, (m.get(owner)||0) - amt);
  }
  for (const b of postTB) {
    if (b.mint !== mint) continue;
    const owner = b.owner ?? b.accountIndex;
    const amt = Number(b.uiTokenAmount?.uiAmount || 0);
    m.set(owner, (m.get(owner)||0) + amt);
  }
  return m;
}

async function handleSignature(signature) {
  try {
    const tx = await rpc('getTransaction', [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
    if (!tx) return;

    const message = tx?.transaction?.message;
    const keys = message?.accountKeys || [];
    const preLamports = tx?.meta?.preBalances || [];
    const postLamports = tx?.meta?.postBalances || [];
    const preTB = tx?.meta?.preTokenBalances || [];
    const postTB = tx?.meta?.postTokenBalances || [];

    if ((!preTB.length && !postTB.length) || !keys.length) return;

    // signer pubkeys
    const signerKeys = keys.filter(k => k?.signer).map(k => k.pubkey || k);
    if (!signerKeys.length) return;

    // base token deltas by owner
    const baseDeltaByOwner = buildBaseDeltaByOwner(preTB, postTB, MINT);

    // For each signer, compute SOL lamports delta at its key index(es)
    let best = null; // { owner, baseDelta }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const pubkey = k?.pubkey || k;
      if (!signerKeys.includes(pubkey)) continue;

      const solDeltaLamports = (postLamports[i] || 0) - (preLamports[i] || 0); // negative if spent SOL
      const baseDelta = Number(baseDeltaByOwner.get(pubkey) || 0);

      if (baseDelta > 0 && solDeltaLamports < 0) {
        if (!best || baseDelta > best.baseDelta) best = { owner: pubkey, baseDelta };
      }
    }

    if (!best) return; // no signer that both gained base and spent SOL

    if (!priceNative || priceNative <= 0) await refreshDex();
    if (!priceNative || priceNative <= 0) return;
    const amountSol = best.baseDelta * priceNative;

    const level = levelFor(amountSol);
    if (level > 0) {
      broadcast({ type: 'buy', amountSol, wallet: best.owner, level, txHash: signature, src: 'rpc-logs' });
    }
  } catch (e) {
    // ignore per-tx errors
  }
}

// ---------- Startup ----------
(async () => {
  console.log('[BUILD]', BUILD_TAG);
  await refreshDex();
  setInterval(refreshDex, 10_000);
  connectWS(true);

  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Overlay:   http://localhost:${PORT}/overlay`);
    console.log(`Events:    http://localhost:${PORT}/events`);
  });
})();
