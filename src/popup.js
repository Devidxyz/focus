import {
  loadSettings, saveSettings, newRuleId, compilePattern, patternMatches, ruleLabel,
} from './common.js';

const $ = (id) => document.getElementById(id);
let settings = null;
let currentUrl = null;

function setStatus() {
  const n = settings.rules.filter((r) => r.enabled !== false).length;
  $('status').textContent = settings.enabled
    ? `Watching ${n} pattern${n === 1 ? '' : 's'}`
    : 'Paused';
}

function flashSaved() {
  $('saved').textContent = 'Saved';
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => ($('saved').textContent = ''), 1200);
}

async function commit() {
  await saveSettings(settings);
  setStatus();
  flashSaved();
}

function showError(msg) {
  const el = $('err');
  el.textContent = msg;
  el.hidden = !msg;
}

function renderRules(sessions) {
  const list = $('rules');
  list.textContent = '';
  $('empty').hidden = settings.rules.length > 0;

  for (const rule of settings.rules) {
    const li = document.createElement('li');
    if (rule.enabled === false) li.className = 'off';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.title = 'Watch this pattern';
    toggle.addEventListener('change', async () => {
      rule.enabled = toggle.checked;
      await commit();
      refresh();
    });

    const pat = document.createElement('span');
    pat.className = 'pat';
    pat.textContent = ruleLabel(rule);
    pat.title = rule.pattern + (currentUrl && patternMatches(rule.pattern, currentUrl) ? ' — matches the current page' : '');
    if (currentUrl && patternMatches(rule.pattern, currentUrl)) pat.textContent = '● ' + pat.textContent;

    const time = document.createElement('span');
    const s = sessions && sessions[rule.id];
    time.className = 'time' + (s && s.active ? ' live' : '');
    time.textContent = s ? s.text : '–';
    time.title = s ? 'Time in the current session' : 'No active session';

    const reset = document.createElement('button');
    reset.className = 'icon';
    reset.textContent = '↺';
    reset.title = 'Reset this timer';
    reset.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'RESET_SESSION', ruleId: rule.id });
      refresh();
    });

    const del = document.createElement('button');
    del.className = 'icon';
    del.textContent = '✕';
    del.title = 'Remove';
    del.addEventListener('click', async () => {
      settings.rules = settings.rules.filter((r) => r.id !== rule.id);
      await commit();
      await chrome.runtime.sendMessage({ type: 'RESET_SESSION', ruleId: rule.id });
      refresh();
    });

    li.append(toggle, pat, time, reset, del);
    list.appendChild(li);
  }
}

async function refresh() {
  let sessions = {};
  try {
    sessions = (await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' })) || {};
  } catch { /* worker asleep or restarting */ }
  renderRules(sessions);
}

async function addPattern(raw) {
  const pattern = String(raw || '').trim();
  if (!pattern) return;
  if (!compilePattern(pattern)) {
    showError('That does not look like a site pattern.');
    return;
  }
  if (settings.rules.some((r) => r.pattern.toLowerCase() === pattern.toLowerCase())) {
    showError('Already on the list.');
    return;
  }
  showError('');
  settings.rules.push({ id: newRuleId(), pattern, enabled: true });
  $('pattern').value = '';
  await commit();
  refresh();
}

function bindNumber(id, key, min, max) {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', async () => {
    const v = Number(el.value);
    settings[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : settings[key];
    el.value = settings[key];
    await commit();
  });
}

async function init() {
  settings = await loadSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab && tab.url;

  $('enabled').checked = settings.enabled;
  $('enabled').addEventListener('change', async () => {
    settings.enabled = $('enabled').checked;
    await commit();
  });

  bindNumber('graceMinutes', 'graceMinutes', 0, 120);
  bindNumber('warnMinutes', 'warnMinutes', 0, 240);
  bindNumber('warnSeconds', 'warnSeconds', 1, 60);

  $('position').value = settings.position;
  $('position').addEventListener('change', async () => {
    settings.position = $('position').value;
    await commit();
  });

  $('add').addEventListener('click', () => addPattern($('pattern').value));
  $('pattern').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPattern($('pattern').value);
  });

  const fill = (withPath) => {
    if (!currentUrl) return;
    try {
      const u = new URL(currentUrl);
      $('pattern').value = withPath ? u.hostname + u.pathname : u.hostname;
      $('pattern').focus();
    } catch { /* not an http page */ }
  };
  $('fill-site').addEventListener('click', () => fill(false));
  $('fill-page').addEventListener('click', () => fill(true));

  $('reset-all').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'RESET_ALL' });
    refresh();
  });

  setStatus();
  refresh();
  setInterval(refresh, 1000);
}

init();
