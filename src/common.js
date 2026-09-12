// Shared helpers used by the service worker and the popup.

export const DEFAULT_SETTINGS = {
  enabled: true,
  // A session survives this many minutes away from the site before it resets.
  graceMinutes: 1,
  // Show a nudge every N minutes of accumulated time (0 disables nudges).
  warnMinutes: 5,
  // How long the nudge stays on screen.
  warnSeconds: 5,
  // top-left | top-center | top-right | bottom-left | bottom-center | bottom-right
  // | custom (set by dragging the timer, stored in customPos)
  position: 'top-right',
  // Fractions of the free space in each axis, like background-position:
  // {x:0,y:0} is the top-left corner, {x:1,y:1} the bottom-right one.
  customPos: null,
  // small | medium | large
  timerSize: 'large',
  timerOpacity: 0.85,
  // glow (red vignette on the screen edges) | tint (whole screen) | banner
  alertStyle: 'glow',
  rules: [],
};

export const TIMER_SIZES = { small: 20, medium: 28, large: 38 };

export function clamp01(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function withDefaults(stored) {
  const s = Object.assign({}, DEFAULT_SETTINGS, stored || {});
  s.rules = Array.isArray(s.rules) ? s.rules : [];
  return s;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return withDefaults(settings);
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

export function newRuleId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- URL matching -----------------------------------------------------------
//
// Patterns are written without a scheme, as `host[/path]`:
//
//   reddit.com                     -> reddit.com and www.reddit.com, any path
//   *.reddit.com                   -> reddit.com and every subdomain
//   old.reddit.com                 -> that subdomain only
//   discord.com/channels/12345     -> one Discord server (and everything under it)
//   youtube.com/watch              -> video pages only, not the home page
//   news.ycombinator.com/*         -> explicit trailing wildcard, same as no path
//
// The path part is a prefix match that stops on a path boundary, so
// `/channels/12` does not match `/channels/123`. `*` is a free wildcard.

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegexSource(part) {
  return part.split('*').map(escapeRegex).join('.*');
}

export function compilePattern(pattern) {
  let p = String(pattern || '').trim();
  if (!p) return null;
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // drop scheme
  p = p.replace(/^\/+/, '');
  if (!p) return null;

  const slash = p.indexOf('/');
  const hostPat = (slash === -1 ? p : p.slice(0, slash)).toLowerCase();
  const pathPat = slash === -1 ? '' : p.slice(slash);
  // A host can only be these characters. Without this check any stray line in
  // an imported list ("not a url at all") would be accepted as a pattern that
  // silently never matches anything. A port is rejected too: URL.hostname
  // never includes one, so `localhost:3000` could not match either.
  if (!/^[a-z0-9.*_-]+$/.test(hostPat)) return null;

  let hostTest;
  if (hostPat.startsWith('*.') && !hostPat.slice(2).includes('*')) {
    const base = hostPat.slice(2);
    hostTest = (host) => host === base || host.endsWith('.' + base);
  } else if (hostPat.includes('*')) {
    const re = new RegExp('^' + wildcardToRegexSource(hostPat) + '$');
    hostTest = (host) => re.test(host);
  } else {
    hostTest = (host) => host === hostPat || host === 'www.' + hostPat;
  }

  let pathTest;
  if (!pathPat || pathPat === '/' || pathPat === '/*') {
    pathTest = () => true;
  } else {
    const trailingWildcard = pathPat.endsWith('*');
    const body = wildcardToRegexSource(pathPat);
    const re = new RegExp('^' + body + (trailingWildcard ? '' : '($|[/?#&])'));
    pathTest = (path) => re.test(path);
  }

  return { hostTest, pathTest, specificity: p.length };
}

export function parseUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { host: u.hostname.toLowerCase(), path: u.pathname + u.search };
  } catch {
    return null;
  }
}

export function patternMatches(pattern, url) {
  const c = compilePattern(pattern);
  const target = parseUrl(url);
  if (!c || !target) return false;
  return c.hostTest(target.host) && c.pathTest(target.path);
}

// Returns the most specific enabled rule matching `url`, or null.
export function findRule(url, rules) {
  const target = parseUrl(url);
  if (!target) return null;
  let best = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const c = compilePattern(rule.pattern);
    if (!c) continue;
    if (c.hostTest(target.host) && c.pathTest(target.path) && c.specificity > bestScore) {
      best = rule;
      bestScore = c.specificity;
    }
  }
  return best;
}

// --- formatting -------------------------------------------------------------

export function formatDuration(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function ruleLabel(rule) {
  return (rule && (rule.label || rule.pattern)) || '';
}

// --- import / export --------------------------------------------------------

export const EXPORT_TYPE = 'focus-timer-sites';
export const EXPORT_VERSION = 1;

export function buildExport(rules, now = new Date()) {
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exported: now.toISOString(),
    rules: rules.map((r) => ({ pattern: r.pattern, enabled: r.enabled !== false })),
  };
}

export function exportFilename(now = new Date()) {
  return `focus-timer-sites-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Reads back anything sensible: our own export, a bare JSON array (of rule
 * objects or plain strings), or a hand-written list with one pattern per line
 * and `#` comments.
 *
 * Throws when the file clearly is not a site list. Entries that are individually
 * unusable are counted in `invalid` rather than failing the whole import.
 */
export function parseImport(text) {
  const result = { rules: [], invalid: 0 };

  const add = (pattern, enabled) => {
    const p = String(pattern == null ? '' : pattern).trim();
    if (!p) return;
    if (!compilePattern(p)) { result.invalid++; return; }
    result.rules.push({ pattern: p, enabled: enabled !== false });
  };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }

  const structured = data !== null && (Array.isArray(data) || typeof data === 'object');
  if (structured) {
    const list = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(list)) throw new Error('That file has no site list in it.');
    for (const item of list) {
      if (typeof item === 'string') add(item, true);
      else if (item && typeof item === 'object') add(item.pattern, item.enabled);
      else result.invalid++;
    }
    return result;
  }

  // Not JSON (or JSON that is just a number/string): treat it as a plain list.
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    add(trimmed, true);
  }
  return result;
}

/** Adds imported rules to the existing ones. Never removes or overwrites. */
export function mergeRules(existing, incoming, makeId = newRuleId) {
  const seen = new Set(existing.map((r) => r.pattern.trim().toLowerCase()));
  const rules = existing.slice();
  let added = 0;
  let duplicates = 0;
  for (const rule of incoming) {
    const key = rule.pattern.trim().toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    rules.push({ id: makeId(), pattern: rule.pattern, enabled: rule.enabled !== false });
    added++;
  }
  return { rules, added, duplicates };
}
