// Overlay logic w/ MC ticker display
const config = {
  sseUrl: "/events",
  buyLevels: [
    { level: 5, minSol: 10 },
    { level: 4, minSol: 5 },
    { level: 3, minSol: 1 },
    { level: 2, minSol: 0.5 },
    { level: 1, minSol: 0.1 }
  ],
  backgroundLevels: [
    { bg: 1, minMC: 0 },
    { bg: 2, minMC: 500_000 },
    { bg: 3, minMC: 1_000_000 },
    { bg: 4, minMC: 2_000_000 },
    { bg: 5, minMC: 5_000_000 }
  ],
  thankYouMinSol: .1,
  thankYouDuration: 7000,
  milestone: {
    enabled: true,
    file: "milestone.webm",
    textTemplate: "CONGRATULATIONS! WE'VE REACHED {MC} MARKET CAP!",
    textDuration: 6000
  }
};

const stage = document.getElementById('stage');
const debugBox = document.getElementById('debugBox');
const mcTicker = document.getElementById('mcTicker');
const anim = document.getElementById('anim');
const animLayer = document.getElementById('animLayer');
const blackout = document.getElementById('blackout');
const banner = document.getElementById('milestoneBanner');

let currentBG = 1;
let isPlayingBuy = false;
let isPlayingMilestone = false;
const buyQueue = [];
let offlineTimer = null;

function log(msg) {
  const now = new Date().toLocaleTimeString();
  if (debugBox) debugBox.textContent = `[${now}] ${msg}`;
}

function setMcText(mc) {
  if (!mcTicker) return;
  const v = Math.round(Number(mc) || 0).toLocaleString();
  mcTicker.textContent = `$${v}`;
}

// Backgrounds
function resolveBackgroundUrl(level, cb) {
  const exts = ['png','jpg','jpeg','webp'];
  let i = 0;
  function tryNext() {
    if (i >= exts.length) { cb(null); return; }
    const url = `./assets/backgrounds/bg${level}.` + exts[i++];
    const img = new Image();
    img.onload = () => cb(url);
    img.onerror = tryNext;
    img.src = url + '?v=' + Date.now();
  }
  tryNext();
}
function setBackground(level) {
  currentBG = level;
  resolveBackgroundUrl(level, (url) => {
    stage.style.backgroundImage = url ? `url('${url}')` : 'none';
  });
  log(`Background -> ${level}`);
}

// Idle video (smooth loop)
function canPlayWebM() {
  const v = document.createElement('video');
  return !!v.canPlayType('video/webm; codecs="vp9"') || !!v.canPlayType('video/webm');
}
function ensureIdle() {
  const src = canPlayWebM()
    ? './assets/animations/idle.webm'
    : './assets/animations/idle.mp4';

  anim.src = src;
  anim.muted = true;
  anim.playsInline = true;
  anim.loop = true;
  anim.preload = 'auto';

  const onCanPlay = () => {
    anim.removeEventListener('canplay', onCanPlay);
    if (anim.paused) anim.play().catch(()=>{});
    log('Idle loop playing');
  };
  anim.addEventListener('canplay', onCanPlay, { once: true });
  anim.addEventListener('ended', () => { try { anim.currentTime = 0; } catch {}; anim.play().catch(()=>{}); });
  anim.addEventListener('error', () => { log('Idle video failed to load (check assets/animations/idle.webm or idle.mp4).'); });
}
function showIdle(show){ if (show){ anim.style.display='block'; anim.play().catch(()=>{});} else { anim.pause(); anim.style.display='none'; }}

// Buy animations
function playBuyClip(level) {
  if (isPlayingMilestone) { buyQueue.push(level); return; }
  if (isPlayingBuy) { buyQueue.push(level); return; }
  isPlayingBuy = true;
  showIdle(false);

  const vid = document.createElement('video');
  vid.src = `./assets/animations/animL${level}.webm`;
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = true;
  vid.style.maxWidth = '85vw';
  vid.style.maxHeight = '85vh';
  animLayer.appendChild(vid);

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    try { animLayer.removeChild(vid); } catch {}
    isPlayingBuy = false;
    showIdle(true);
    if (buyQueue.length) playBuyClip(buyQueue.shift());
  };

  vid.onended = cleanup;
  vid.onerror = () => { log(`Animation L${level} failed to load.`); cleanup(); };
  setTimeout(cleanup, Math.min(15000, 4000 + level * 2000));
}

function showThankYou(wallet, amountSol) {
  const el = document.createElement('div');
  el.className = 'thankyou';
  const short = `${wallet?.slice(0,4) || '????'}…${wallet?.slice(-4) || '????'}`;
  el.textContent = `Thanks ${short} for ${amountSol.toFixed(4)} SOL!`;
  stage.appendChild(el);
  setTimeout(() => { try { stage.removeChild(el); } catch {} }, 7000);
}

// Milestones
function fmtUSD(n) { try { return '$' + Number(Math.round(n)).toLocaleString(); } catch { return '$' + n; } }
function showBanner(text) { if (!banner) return; banner.textContent = text; banner.classList.add('show'); banner.style.display='block'; }
function hideBanner() { if (!banner) return; banner.classList.remove('show'); setTimeout(()=>{ banner.style.display='none'; }, 500); }
function setBlackout(on) { if(!blackout) return; if(on){ blackout.classList.add('show'); blackout.style.display='block'; } else { blackout.classList.remove('show'); setTimeout(()=>{ blackout.style.display='none'; }, 500); } }
function mcForBg(bg) { const entry = config.backgroundLevels.find(b => b.bg === bg); return entry ? entry.minMC : 0; }
function playMilestone(bg) {
  if (!config.milestone?.enabled) return Promise.resolve();
  const file = config.milestone.file;
  if (!file) return Promise.resolve();
  return new Promise((resolve) => {
    isPlayingMilestone = true;
    showIdle(false);
    setBlackout(true);
    const mcText = fmtUSD(mcForBg(bg));
    const msg = (config.milestone.textTemplate || '').replace('{MC}', mcText);
    if (msg) showBanner(msg);
    const vid = document.createElement('video');
    vid.src = `./assets/animations/${file}`;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.muted = true;
    vid.style.maxWidth = '85vw';
    vid.style.maxHeight = '85vh';
    animLayer.appendChild(vid);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { animLayer.removeChild(vid); } catch {}
      hideBanner();
      setBlackout(false);
      isPlayingMilestone = false;
      resolve();
    };
    vid.onended = finish; vid.onerror = finish;
    setTimeout(finish, Math.min(15000, (config.milestone.textDuration || 6000) + 4000));
  });
}

// Events
function handleBuy(amountSol, wallet) {
  const level = config.buyLevels.find(l => amountSol >= l.minSol)?.level || null;
  if (level) playBuyClip(level);
  if (amountSol >= config.thankYouMinSol) showThankYou(wallet, amountSol);
  log(`Buy ${amountSol} SOL -> level ${level || 'none'}`);
}
function handleMarketCap(mc) {
  setMcText(mc); // update UI
  const bg = [...config.backgroundLevels].sort((a,b)=>b.minMC-a.minMC).find(b => mc >= b.minMC)?.bg;
  if (bg && bg > currentBG) {
    log(`Milestone reached: BG${bg}`);
    playMilestone(bg).then(() => { setBackground(bg); showIdle(true); });
  }
  log(`Market Cap: $${Math.round(mc).toLocaleString()}`);
}

// SSE
function setOfflineUI(){ log('Offline: idle playing, retrying connection…'); }
function connectSSE() {
  try { if (offlineTimer) clearTimeout(offlineTimer); } catch {}
  const es = new EventSource(config.sseUrl);
  offlineTimer = setTimeout(() => setOfflineUI(), 5000);
  es.onopen = () => { try { if (offlineTimer) clearTimeout(offlineTimer); } catch {}; log('Connected to server.'); };
  es.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'marketcap') handleMarketCap(msg.mc);
      if (msg.type === 'buy') handleBuy(Number(msg.amountSol), msg.wallet);
      if (msg.type === 'hello') log('Connected to server.');
    } catch (e) { console.error(e); }
  };
  es.onerror = () => { setOfflineUI(); try { es.close(); } catch {}; setTimeout(connectSSE, 2000); };
}

// Boot
setBackground(1);
ensureIdle();
showIdle(true);
connectSSE();
