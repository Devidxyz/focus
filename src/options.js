import {
  loadSettings, saveSettings, newRuleId, ruleLabel,
  buildExport, exportFilename, parseImport, mergeRules,
} from './common.js';

const $ = (id) => document.getElementById(id);
let settings = null;

function say(message, bad = false) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.hidden = false;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function render() {
  $('export-count').textContent = settings.rules.length
    ? `${plural(settings.rules.length, 'site')} on the list`
    : 'nothing to export yet';
  $('export').disabled = settings.rules.length === 0;

  const list = $('rules');
  list.textContent = '';
  $('empty').hidden = settings.rules.length > 0;
  for (const rule of settings.rules) {
    const li = document.createElement('li');
    if (rule.enabled === false) li.className = 'off';
    const pat = document.createElement('span');
    pat.className = 'pat';
    pat.textContent = ruleLabel(rule);
    const state = document.createElement('span');
    state.className = 'time';
    state.textContent = rule.enabled === false ? 'paused' : '';
    li.append(pat, state);
    list.appendChild(li);
  }
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function importText(text, source) {
  let parsed;
  try {
    parsed = parseImport(text);
  } catch (err) {
    say(err.message || 'That file could not be read.', true);
    return;
  }

  if (!parsed.rules.length) {
    const detail = parsed.invalid ? ` ${plural(parsed.invalid, 'line')} could not be understood.` : '';
    say(`No usable site patterns in ${source}.${detail}`, true);
    return;
  }

  const { rules, added, duplicates } = mergeRules(settings.rules, parsed.rules, newRuleId);
  settings.rules = rules;
  await saveSettings(settings);
  render();

  const parts = [`Added ${plural(added, 'site')}`];
  if (duplicates) parts.push(`${plural(duplicates, 'site')} already on the list`);
  if (parsed.invalid) parts.push(`${plural(parsed.invalid, 'entry')} skipped as unreadable`);
  say(parts.join(', ') + '.');
}

async function importFile(file) {
  if (!file) return;
  try {
    await importText(await file.text(), file.name);
  } catch {
    say('That file could not be read.', true);
  }
}

async function init() {
  settings = await loadSettings();
  render();

  $('export').addEventListener('click', () => {
    const text = JSON.stringify(buildExport(settings.rules), null, 2);
    download(exportFilename(), text);
    say(`Exported ${plural(settings.rules.length, 'site')}.`);
  });

  $('file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';   // so the same file can be picked again
    importFile(file);
  });

  $('import-text').addEventListener('click', () => {
    const text = $('text').value.trim();
    if (!text) {
      say('Paste a list first.', true);
      return;
    }
    importText(text, 'the pasted text').then(() => { $('text').value = ''; });
  });

  const drop = $('drop');
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, () => drop.classList.remove('over'));
  }
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    importFile(event.dataTransfer && event.dataTransfer.files[0]);
  });

  // Another window may have changed the list while this page was open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      loadSettings().then((fresh) => { settings = fresh; render(); });
    }
  });
}

init();
