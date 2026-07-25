import { openMemoryDb } from './memory.js';
import { loadFont } from './handwriting.js';
import { createSettingsStore, showSettings, initSettingsGesture } from './settings.js';
import { initApp } from './app.js';

const canvas = document.getElementById('page');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw failed', e));
}

const db = await openMemoryDb();
const settingsStore = createSettingsStore(db);
const font = await loadFont('./fonts/DancingScript.ttf');

// A corner long-press opens settings any time. Wired before initApp so its
// capture-phase pointerdown listener is registered ahead of ink's (listeners
// on the same target run in registration order within a phase bucket).
initSettingsGesture(canvas, { onOpen: () => showSettings(document.body, { store: settingsStore, onClose: () => {} }) });

const current = await settingsStore.load();
initApp(canvas, { db, font, settingsStore, offsetHours: current.tzOffset });

// First launch with no key: open settings straight away.
if (!current.key) showSettings(document.body, { store: settingsStore, onClose: () => {} });

document.body.dataset.ready = 'true';
