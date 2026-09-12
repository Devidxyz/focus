import { loadSettings, withDefaults, findRule, formatDuration, ruleLabel } from './common.js';

// The content script pings roughly once a second while its page is visible and
// focused. Those pings are the only clock: if they stop (tab hidden, window
// blurred, tab closed) the session simply stops accumulating. A single ping is
// never allowed to credit more than this, so a gap inside the grace window
// does not get counted as time spent.
const MAX_TICK_MS = 3000;
const PERSIST_EVERY_MS = 5000;

let settings = null;
let sessions = null; // ruleId -> { accumMs, startedAt, lastTickAt, warnLevel }
let lastPersistAt = 0;

async function ensureState() {
  if (!settings) settings = await loadSettings();
  if (!sessions) {
    const stored = await chrome.storage.local.get('sessions');
    sessions = stored.sessions || {};
  }
}

async function persist(force) {
  const now = Date.now();
  if (!force && now - lastPersistAt < PERSIST_EVERY_MS) return;
  lastPersistAt = now;
  await chrome.storage.local.set({ sessions });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = withDefaults(changes.settings.newValue);
  }
});

// Drop sessions whose grace window has long expired so storage stays small.
function pruneSessions(now, graceMs) {
  for (const [id, s] of Object.entries(sessions)) {
    if (now - s.lastTickAt > Math.max(graceMs, 60000) * 4) delete sessions[id];
  }
}

function display(settings) {
  return {
    position: settings.position,
    warnSeconds: settings.warnSeconds,
  };
}

// "5 minutes", "1.5 minutes", "90 seconds" — whichever reads best for the
// configured reminder interval.
function describeThreshold(ms) {
  if (ms < 60000) {
    const secs = Math.round(ms / 1000);
    return `${secs} second${secs === 1 ? '' : 's'}`;
  }
  const mins = Number((ms / 60000).toFixed(1));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

async function handlePing(url, tabId) {
  await ensureState();
  const now = Date.now();

  if (!settings.enabled) return { tracked: false };
  const rule = findRule(url, settings.rules);
  if (!rule) return { tracked: false };

  const graceMs = Math.max(0, Number(settings.graceMinutes) || 0) * 60000;
  let session = sessions[rule.id];
  let fresh = false;

  if (!session || now - session.lastTickAt > graceMs) {
    session = { accumMs: 0, startedAt: now, lastTickAt: now, warnLevel: 0, intervalMs: 0 };
    sessions[rule.id] = session;
    fresh = true;
    pruneSessions(now, graceMs);
  } else {
    session.accumMs += Math.min(now - session.lastTickAt, MAX_TICK_MS);
    session.lastTickAt = now;
  }

  let warning = null;
  const intervalMs = Math.max(0, Number(settings.warnMinutes) || 0) * 60000;
  if (intervalMs > 0) {
    // If the reminder interval was changed mid-session, warnLevel is still on
    // the old scale. Rebase it so the next reminder lands on the next boundary
    // of the new interval instead of firing a burst (or going silent).
    if (session.intervalMs !== intervalMs) {
      session.intervalMs = intervalMs;
      session.warnLevel = Math.floor(session.accumMs / intervalMs);
    }
    const level = Math.floor(session.accumMs / intervalMs);
    if (level > session.warnLevel) {
      session.warnLevel = level;
      warning = {
        id: `${rule.id}:${level}`,
        title: `${describeThreshold(level * intervalMs)} here`,
        detail: ruleLabel(rule),
      };
    }
  }

  await persist(fresh || !!warning);

  if (typeof tabId === 'number') {
    const mins = Math.floor(session.accumMs / 60000);
    chrome.action.setBadgeText({ tabId, text: mins > 0 ? String(mins) : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#d9534f' }).catch(() => {});
  }

  return {
    tracked: true,
    ruleId: rule.id,
    label: ruleLabel(rule),
    elapsedMs: session.accumMs,
    text: formatDuration(session.accumMs),
    warning,
    ...display(settings),
  };
}

async function getSessions() {
  await ensureState();
  const now = Date.now();
  const graceMs = Math.max(0, Number(settings.graceMinutes) || 0) * 60000;
  const out = {};
  for (const [id, s] of Object.entries(sessions)) {
    out[id] = {
      elapsedMs: s.accumMs,
      text: formatDuration(s.accumMs),
      active: now - s.lastTickAt <= Math.max(graceMs, 2000),
      lastTickAt: s.lastTickAt,
    };
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ensureState();
    switch (msg && msg.type) {
      case 'PING':
        sendResponse(await handlePing(msg.url, sender.tab && sender.tab.id));
        break;
      case 'GET_SESSIONS':
        sendResponse(await getSessions());
        break;
      case 'RESET_SESSION':
        delete sessions[msg.ruleId];
        await persist(true);
        sendResponse({ ok: true });
        break;
      case 'RESET_ALL':
        sessions = {};
        await persist(true);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false });
    }
  })().catch((err) => sendResponse({ error: String(err) }));
  return true; // keep the message channel open for the async response
});
