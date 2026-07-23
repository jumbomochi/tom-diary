// Settings: pure serialization + an IndexedDB record + the panel UI. The pure
// part maps a stored record to the askOracle config the driver uses.
import { DEFAULT_BASE, DEFAULT_MAX_TOKENS } from './oracle.js';
import { memoryEnabled } from './memory.js';

/** The knobs from oracle.env, web-side. `key` empty means "not configured yet". */
export const DEFAULT_SETTINGS = {
  base: DEFAULT_BASE,
  key: '',
  model: 'gpt-4o-mini',
  reasoning: '',
  maxTokens: DEFAULT_MAX_TOKENS,
  memory: 'on',
  tzOffset: 0,
};

/** Fill missing fields with defaults; coerce numeric fields. */
export function normalizeSettings(raw) {
  const r = raw || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    base: r.base != null && r.base !== '' ? String(r.base) : DEFAULT_SETTINGS.base,
    key: r.key != null ? String(r.key) : DEFAULT_SETTINGS.key,
    model: r.model != null && r.model !== '' ? String(r.model) : DEFAULT_SETTINGS.model,
    reasoning: r.reasoning != null ? String(r.reasoning) : DEFAULT_SETTINGS.reasoning,
    maxTokens: num(r.maxTokens, DEFAULT_SETTINGS.maxTokens),
    memory: r.memory != null ? String(r.memory) : DEFAULT_SETTINGS.memory,
    tzOffset: num(r.tzOffset, DEFAULT_SETTINGS.tzOffset),
  };
}

/** Map a normalized settings record to the askOracle config. */
export function settingsToConfig(settings) {
  return {
    base: settings.base,
    key: settings.key,
    model: settings.model,
    maxTokens: settings.maxTokens,
    reasoning: settings.reasoning ? settings.reasoning : null,
    remember: memoryEnabled(settings.memory),
  };
}

const SETTINGS_STORE = 'settings';
const CONFIG_KEY = 'config';

const reqPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** A tiny read/write wrapper over the single settings record. */
export function createSettingsStore(db) {
  const store = (mode) => db.transaction(SETTINGS_STORE, mode).objectStore(SETTINGS_STORE);
  return {
    async load() {
      const row = await reqPromise(store('readonly').get(CONFIG_KEY));
      return normalizeSettings(row ? row.value : undefined);
    },
    async save(settings) {
      const value = normalizeSettings(settings);
      await reqPromise(store('readwrite').put({ key: CONFIG_KEY, value }));
    },
  };
}

const FIELDS = [
  { key: 'key', label: 'API key', type: 'password' },
  { key: 'base', label: 'Base URL', type: 'text' },
  { key: 'model', label: 'Model', type: 'text' },
  { key: 'reasoning', label: 'Reasoning effort (blank = none)', type: 'text' },
  { key: 'maxTokens', label: 'Max tokens', type: 'number' },
  { key: 'memory', label: 'Memory (on/off)', type: 'text' },
  { key: 'tzOffset', label: 'Timezone offset (hours)', type: 'number' },
];

/** Render the settings form, save on submit, self-remove on close. */
export function showSettings(root, { store, onClose } = {}) {
  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  const form = document.createElement('form');
  form.className = 'settings-form';
  const title = document.createElement('h1');
  title.textContent = 'The Diary — Settings';
  form.appendChild(title);

  const inputs = {};
  for (const f of FIELDS) {
    const wrap = document.createElement('label');
    wrap.className = 'settings-row';
    wrap.textContent = f.label;
    const input = document.createElement('input');
    input.type = f.type;
    input.name = f.key;
    wrap.appendChild(input);
    form.appendChild(wrap);
    inputs[f.key] = input;
  }
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  save.className = 'settings-save';
  form.appendChild(save);
  panel.appendChild(form);
  root.appendChild(panel);

  let done = false;
  const close = (saved) => { if (done) return; done = true; panel.remove(); if (onClose) onClose(saved); };

  Promise.resolve(store.load()).then((s) => {
    for (const f of FIELDS) inputs[f.key].value = s[f.key];
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = {};
    for (const f of FIELDS) raw[f.key] = inputs[f.key].value;
    const saved = normalizeSettings(raw);
    await store.save(saved);
    close(saved);
  });

  return () => close(null);
}

/** A long-press in the top-left corner opens settings. */
export function initSettingsGesture(canvas, { onOpen, holdMs = 600, cornerFrac = 0.12 } = {}) {
  let timer = null;
  const inCorner = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return x <= rect.width * cornerFrac && y <= rect.height * cornerFrac;
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const onDown = (e) => { if (inCorner(e)) timer = setTimeout(() => { timer = null; onOpen(); }, holdMs); };
  const onMove = (e) => { if (timer && !inCorner(e)) cancel(); };
  canvas.addEventListener('pointerdown', onDown, true); // capture: run before initInk
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', cancel, true);
  canvas.addEventListener('pointercancel', cancel, true);
  return () => {
    cancel();
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove, true);
    canvas.removeEventListener('pointerup', cancel, true);
    canvas.removeEventListener('pointercancel', cancel, true);
  };
}
