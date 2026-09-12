/* Focus Timer — on-page overlay.
 *
 * This script is the clock source: it pings the service worker about once a
 * second while the page is actually in front of the user (visible tab + focused
 * window). It never blocks anything — the overlay is pointer-events: none, so
 * clicks pass straight through to the page underneath.
 */
(() => {
  if (window.__focusTimerLoaded) return;
  window.__focusTimerLoaded = true;

  const LOOP_MS = 500;         // local heartbeat, no messaging
  const PING_TRACKED_MS = 1000;
  const PING_IDLE_MS = 5000;   // slow poll on pages that are not watched

  let host = null;
  let shadow = null;
  let pill = null;
  let toast = null;
  let toastTimer = null;
  let lastWarningId = null;
  let lastUrl = location.href;
  let lastPingAt = 0;
  let tracked = false;
  let pending = false;

  const POSITIONS = {
    'top-left': 'top:12px;left:12px;align-items:flex-start;',
    'top-center': 'top:12px;left:50%;transform:translateX(-50%);align-items:center;',
    'top-right': 'top:12px;right:12px;align-items:flex-end;',
    'bottom-left': 'bottom:12px;left:12px;align-items:flex-start;flex-direction:column-reverse;',
    'bottom-center': 'bottom:12px;left:50%;transform:translateX(-50%);align-items:center;flex-direction:column-reverse;',
    'bottom-right': 'bottom:12px;right:12px;align-items:flex-end;flex-direction:column-reverse;',
  };

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = '__focus_timer_root';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .wrap {
        position: fixed;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
        font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .pill {
        display: flex; align-items: center; gap: 7px;
        padding: 5px 11px;
        border-radius: 999px;
        background: rgba(17, 18, 22, 0.82);
        color: #f4f4f5;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.2px;
        line-height: 1.4;
        box-shadow: 0 2px 10px rgba(0,0,0,0.28);
        backdrop-filter: blur(6px);
        opacity: 0.88;
        white-space: nowrap;
      }
      .dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #ff8a5b;
        box-shadow: 0 0 0 0 rgba(255,138,91,0.6);
        animation: pulse 2.4s ease-out infinite;
      }
      @keyframes pulse {
        0%   { box-shadow: 0 0 0 0 rgba(255,138,91,0.55); }
        70%  { box-shadow: 0 0 0 7px rgba(255,138,91,0); }
        100% { box-shadow: 0 0 0 0 rgba(255,138,91,0); }
      }
      .site { font-weight: 500; opacity: 0.62; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
      .toast {
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(190, 58, 52, 0.96);
        color: #fff;
        box-shadow: 0 8px 26px rgba(0,0,0,0.32);
        max-width: 300px;
        animation: pop 220ms cubic-bezier(.2,.9,.3,1.3);
      }
      .toast.out { animation: fade 380ms ease forwards; }
      .toast .t { font-size: 15px; font-weight: 700; }
      .toast .d { font-size: 12px; opacity: 0.85; margin-top: 3px; word-break: break-all; }
      @keyframes pop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: none; } }
      @keyframes fade { to { opacity: 0; transform: translateY(-6px); } }
      @media (prefers-reduced-motion: reduce) {
        .dot, .toast, .toast.out { animation: none; }
      }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML = '<span class="dot"></span><span class="time">0:00</span><span class="site"></span>';

    wrap.appendChild(pill);
    shadow.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);
    shadow.wrap = wrap;
  }

  function unmount() {
    if (host) host.remove();
    host = shadow = pill = toast = null;
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  function render(state) {
    mount();
    shadow.wrap.style.cssText = POSITIONS[state.position] || POSITIONS['top-right'];
    shadow.wrap.style.position = 'fixed';
    pill.querySelector('.time').textContent = state.text;
    pill.querySelector('.site').textContent = state.label || '';
  }

  function showWarning(warning, seconds) {
    if (!warning || warning.id === lastWarningId) return;
    lastWarningId = warning.id;
    clearTimeout(toastTimer);
    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.className = 'toast';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = `⏱ ${warning.title}`;
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = warning.detail;
    toast.append(t, d);
    shadow.wrap.appendChild(toast);

    const ms = Math.max(1, Number(seconds) || 5) * 1000;
    toastTimer = setTimeout(() => {
      if (!toast) return;
      toast.classList.add('out');
      const node = toast;
      toast = null;
      setTimeout(() => node.remove(), 400);
    }, ms);
  }

  function inForeground() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  async function ping() {
    if (pending) return;
    pending = true;
    lastPingAt = Date.now();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'PING', url: location.href });
      if (!res || !res.tracked) {
        tracked = false;
        lastWarningId = null;
        unmount();
        return;
      }
      tracked = true;
      render(res);
      if (res.warning) showWarning(res.warning, res.warnSeconds);
    } catch {
      // Extension reloaded or context invalidated — drop the overlay quietly.
      tracked = false;
      unmount();
    } finally {
      pending = false;
    }
  }

  function loop() {
    const now = Date.now();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastWarningId = null;
      if (inForeground()) return void ping();
    }
    if (!inForeground()) return;
    const due = tracked ? PING_TRACKED_MS : PING_IDLE_MS;
    if (now - lastPingAt >= due) ping();
  }

  setInterval(loop, LOOP_MS);
  document.addEventListener('visibilitychange', () => { if (inForeground()) ping(); });
  window.addEventListener('focus', () => ping());
  ping();
})();
