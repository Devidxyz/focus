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
  position: 'top-right',
  rules: [],
};

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
  if (!hostPat) return null;

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
