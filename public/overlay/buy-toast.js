/**
 * buy-toast.js
 * Listens to /events and shows a 1s thank-you popup for every buy >= 0.1 SOL.
 * Safe to add alongside your existing overlay.js (separate EventSource).
 */

(function () {
  const TOAST_THRESHOLD = 0.1; // SOL
  const EVENTS_URL = '/events';

  function formatSol(n) {
    if (!Number.isFinite(n)) return '0';
    return Number(n).toFixed(2);
  }

  function shortWallet(addr) {
    if (!addr || typeof addr !== 'string') return 'unknown';
    if (addr.length <= 10) return addr;
    return addr.slice(0, 4) + '...' + addr.slice(-4);
  }

  function ensureContainer() {
    let c = document.getElementById('toasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toasts';
      document.body.appendChild(c);
    }
    return c;
  }

  function showThankYou(amountSol, wallet) {
    if (!(amountSol >= TOAST_THRESHOLD)) return;
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = `CONGRATS & THANK YOU! ${formatSol(amountSol)} SOL — ${shortWallet(wallet)}`;
    container.appendChild(el);

    // Remove shortly after the 1s animation
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1100);
  }

  function start() {
    try {
      const es = new EventSource(EVENTS_URL);
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data && data.type === 'buy') {
            const amount = Number(data.amountSol || 0);
            const wallet = data.wallet || 'unknown';
            showThankYou(amount, wallet);
          }
        } catch {}
      };
      es.onerror = () => { /* let the browser reconnect automatically */ };
    } catch (e) {
      // ignore
    }
  }

  // Wait for DOM, then start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
