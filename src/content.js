/* Focus Timer — on-page overlay.
 *
 * This script is the clock source: it pings the service worker about once a
 * second while the page is actually in front of the user (visible tab + focused
 * window).
 *
 * Only the timer pill takes pointer events, so it can be dragged. Everything
 * else — the reminder card and the screen glow — is pointer-events: none and
 * never intercepts a click on the page underneath.
 */
(() => {
  if (window.__focusTimerLoaded) return;
  window.__focusTimerLoaded = true;

  const LOOP_MS = 500;         // local heartbeat, no messaging
  const PING_TRACKED_MS = 1000;
  const PING_IDLE_MS = 5000;   // slow poll on pages that are not watched

  let host = null;
  let shadow = null;
  let wrap = null;
  let pill = null;
  let fx = null;
  let glow = null;
  let toast = null;
  let toastTimer = null;
  let glowTimer = null;
  let lastWarningId = null;
  let lastUrl = location.href;
  let lastPingAt = 0;
  let tracked = false;
  let pending = false;
  let dragging = false;
  let dragPos = null;
  let positionHold = 0;        // ignore server position right after a drag

  const POSITIONS = {
    'top-left': 'top:16px;left:16px;',
    'top-center': 'top:16px;left:50%;transform:translateX(-50%);',
    'top-right': 'top:16px;right:16px;',
    'bottom-left': 'bottom:16px;left:16px;',
    'bottom-center': 'bottom:16px;left:50%;transform:translateX(-50%);',
    'bottom-right': 'bottom:16px;right:16px;',
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clamp01 = (n) => clamp(Number(n) || 0, 0, 1);

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      pointer-events: none;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .pill {
      position: relative;
      pointer-events: auto;
      cursor: grab;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 8px 16px;
      color: #fff;
    }
    /* The translucency setting fades only this plate, never the digits, so the
       timer stays readable however far down you turn it. */
    .pill::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 14px;
      background: rgba(10, 11, 14, 0.74);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(7px);
      -webkit-backdrop-filter: blur(7px);
      opacity: var(--plate, 0.85);
      transition: opacity .15s ease;
    }
    .pill:hover::before { opacity: 1; }
    .pill.dragging::before { box-shadow: 0 10px 34px rgba(0,0,0,.42); opacity: 1; }
    .pill.dragging { cursor: grabbing; }
    .time, .site { position: relative; }
    .time {
      font-size: var(--size);
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.01em;
      font-variant-numeric: tabular-nums;
      /* A dark outline keeps the white digits readable on a white page even
         when the plate behind them is turned right down. */
      -webkit-text-stroke: 0.6px rgba(0, 0, 0, 0.38);
      text-shadow: 0 1px 3px rgba(0,0,0,.75), 0 0 10px rgba(0,0,0,.5), 0 0 2px rgba(0,0,0,.9);
    }
    .site {
      font-size: calc(var(--size) * 0.34);
      font-weight: 500;
      opacity: .72;
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0,0,0,.8), 0 0 6px rgba(0,0,0,.55);
    }

    /* --- reminder layer ---------------------------------------------------- */
    .fx { position: fixed; inset: 0; pointer-events: none; }
    .glow { position: absolute; inset: 0; opacity: 0; }
    .glow.edge {
      background: radial-gradient(ellipse at center,
        rgba(214,66,56,0) 38%, rgba(214,66,56,.14) 72%, rgba(214,66,56,.44) 100%);
      box-shadow: inset 0 0 clamp(28px, 5vw, 74px) clamp(2px, .7vw, 12px) rgba(214, 66, 56, .55);
    }
    .glow.tint {
      background: radial-gradient(ellipse at center,
        rgba(214,66,56,.11) 0%, rgba(214,66,56,.2) 60%, rgba(214,66,56,.44) 100%);
      box-shadow: inset 0 0 clamp(28px, 5vw, 74px) clamp(2px, .7vw, 12px) rgba(214, 66, 56, .55);
    }
    .glow.on { animation: breathe var(--dur) ease-in-out forwards; }
    /* Two slow swells rather than a flash — hard to miss, easy on the eyes. */
    @keyframes breathe {
      0%   { opacity: 0; }
      14%  { opacity: 1; }
      42%  { opacity: .45; }
      70%  { opacity: .95; }
      86%  { opacity: .6; }
      100% { opacity: 0; }
    }

    .card {
      position: absolute;
      left: 50%;
      top: 17vh;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 26px;
      border-radius: 18px;
      background: rgba(26, 12, 11, 0.94);
      border: 1px solid rgba(255, 122, 110, 0.45);
      box-shadow: 0 18px 50px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.25),
                  0 0 60px rgba(214,66,56,.35);
      color: #ffe6e2;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: min(90vw, 560px);
      animation: rise 300ms cubic-bezier(.2,.9,.3,1.25);
    }
    .card.out { animation: sink 420ms ease forwards; }
    .card .icon { font-size: 34px; line-height: 1; filter: saturate(.9); }
    .card .txt { min-width: 0; }
    .card .t { font-size: 27px; font-weight: 750; letter-spacing: -0.02em; line-height: 1.15; }
    .card .d {
      font-size: 14px; opacity: .68; margin-top: 3px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    @keyframes rise { from { opacity: 0; transform: translate(-50%, 14px) scale(.96); }
                      to   { opacity: 1; transform: translate(-50%, 0) scale(1); } }
    @keyframes sink { to { opacity: 0; transform: translate(-50%, -10px); } }

    @media (prefers-reduced-motion: reduce) {
      .glow.on { animation: steady var(--dur) ease-in-out forwards; }
      @keyframes steady { 0% { opacity: 0; } 10% { opacity: .85; } 90% { opacity: .85; } 100% { opacity: 0; } }
      .card, .card.out { animation: none; }
    }
  `;

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = '__focus_timer_root';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;

    wrap = document.createElement('div');
    wrap.className = 'wrap';
    pill = document.createElement('div');
    pill.className = 'pill';
    pill.title = 'Drag to move';
    pill.innerHTML = '<span class="time">0:00</span><span class="site"></span>';
    pill.addEventListener('pointerdown', startDrag);
    wrap.appendChild(pill);

    fx = document.createElement('div');
    fx.className = 'fx';
    glow = document.createElement('div');
    glow.className = 'glow';
    fx.appendChild(glow);

    shadow.append(style, wrap, fx);
    (document.body || document.documentElement).appendChild(host);
  }

  function unmount() {
    if (host) host.remove();
    host = shadow = wrap = pill = fx = glow = toast = null;
    clearTimeout(toastTimer);
    clearTimeout(glowTimer);
    toastTimer = glowTimer = null;
    dragging = false;
  }

  function applyPosition(state) {
    if (state.position === 'custom' && state.customPos) {
      const x = clamp01(state.customPos.x);
      const y = clamp01(state.customPos.y);
      // Percentage offsets with a matching negative translate reproduce
      // background-position semantics, so the pill keeps its relative spot
      // when the window is resized.
      wrap.style.cssText =
        `position:fixed;left:${x * 100}%;top:${y * 100}%;transform:translate(${-x * 100}%,${-y * 100}%);`;
    } else {
      wrap.style.cssText = 'position:fixed;' + (POSITIONS[state.position] || POSITIONS['top-right']);
    }
  }

  function render(state) {
    mount();
    if (!dragging && Date.now() > positionHold) applyPosition(state);
    pill.style.setProperty('--size', (state.timerPx || 38) + 'px');
    pill.style.setProperty('--plate', String(state.timerOpacity == null ? 0.85 : state.timerOpacity));
    pill.querySelector('.time').textContent = state.text;
    const site = pill.querySelector('.site');
    site.textContent = state.label || '';
    site.style.display = state.label ? '' : 'none';
  }

  // --- dragging --------------------------------------------------------------

  function startDrag(e) {
    if (e.button !== 0 || !pill) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = pill.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    dragging = true;
    pill.classList.add('dragging');
    try { pill.setPointerCapture(e.pointerId); } catch { /* older engines */ }

    const onMove = (ev) => {
      const maxX = Math.max(0, innerWidth - rect.width);
      const maxY = Math.max(0, innerHeight - rect.height);
      const left = clamp(ev.clientX - offX, 0, maxX);
      const top = clamp(ev.clientY - offY, 0, maxY);
      wrap.style.cssText = `position:fixed;left:${left}px;top:${top}px;transform:none;`;
      dragPos = { x: maxX ? left / maxX : 0, y: maxY ? top / maxY : 0 };
    };

    const onUp = async (ev) => {
      dragging = false;
      if (pill) {
        pill.classList.remove('dragging');
        pill.removeEventListener('pointermove', onMove);
        pill.removeEventListener('pointerup', onUp);
        pill.removeEventListener('pointercancel', onUp);
        try { pill.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      if (!dragPos) return;
      // Hold off on server-provided positions until the new one round-trips,
      // otherwise an in-flight ping response snaps the pill back.
      positionHold = Date.now() + 3000;
      const pos = dragPos;
      dragPos = null;
      try {
        await chrome.runtime.sendMessage({ type: 'SET_POSITION', x: pos.x, y: pos.y });
      } catch { /* extension reloading */ }
      positionHold = Date.now() + 600;
    };

    pill.addEventListener('pointermove', onMove);
    pill.addEventListener('pointerup', onUp);
    pill.addEventListener('pointercancel', onUp);
  }

  // --- reminders -------------------------------------------------------------

  function showWarning(warning, seconds, style) {
    if (!warning || warning.id === lastWarningId || !shadow) return;
    lastWarningId = warning.id;
    const secs = Math.max(1, Number(seconds) || 5);

    if (style !== 'banner') {
      clearTimeout(glowTimer);
      glow.className = 'glow';                      // restart the animation
      void glow.offsetWidth;
      glow.style.setProperty('--dur', secs + 's');
      glow.className = `glow ${style === 'tint' ? 'tint' : 'edge'} on`;
      glowTimer = setTimeout(() => { if (glow) glow.className = 'glow'; }, secs * 1000 + 150);
    }

    clearTimeout(toastTimer);
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.className = 'card';
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = '⏳';
    const txt = document.createElement('div');
    txt.className = 'txt';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = warning.title;
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = warning.detail;
    txt.append(t, d);
    toast.append(icon, txt);
    fx.appendChild(toast);

    toastTimer = setTimeout(() => {
      if (!toast) return;
      toast.classList.add('out');
      const node = toast;
      toast = null;
      setTimeout(() => node.remove(), 450);
    }, secs * 1000);
  }

  // --- heartbeat -------------------------------------------------------------

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
      if (res.warning) showWarning(res.warning, res.warnSeconds, res.alertStyle);
    } catch {
      // Extension reloaded or context invalidated — drop the overlay quietly.
      tracked = false;
      unmount();
    } finally {
      pending = false;
    }
  }

  function loop() {
    if (dragging) return;
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
