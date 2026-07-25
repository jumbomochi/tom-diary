import { openMemoryDb } from './memory.js';
import { loadFont } from './handwriting.js';
import { createSettingsStore, showSettings, initSettingsGesture } from './settings.js';
import { initApp, sizeCanvasBacking } from './app.js';

const canvas = document.getElementById('page');
sizeCanvasBacking(canvas);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw failed', e));
}

const db = await openMemoryDb();
const settingsStore = createSettingsStore(db);
const font = await loadFont('./fonts/DancingScript.ttf');

// Open the Settings panel with ink fully suspended: setSettingsOpen(true) also
// erases the transient corner hold-dot the gesture leaves behind, so no junk page
// commits behind the panel; the panel's dismissal resumes ink.
let app;
const openSettings = () => {
  app.setSettingsOpen(true);
  showSettings(document.body, { store: settingsStore, onClose: () => app.setSettingsOpen(false) });
};

// A corner long-press opens settings any time. Wired before initApp so its
// capture-phase pointerdown listener is registered ahead of ink's (listeners
// on the same target run in registration order within a phase bucket); `app` is
// a forward reference resolved by the time the hold completes.
initSettingsGesture(canvas, { onOpen: openSettings });

const current = await settingsStore.load();
app = initApp(canvas, { db, font, settingsStore, offsetHours: current.tzOffset });

// First launch with no key: open settings straight away.
if (!current.key) openSettings();

// Re-size the canvas backing store + offscreen ink layer on viewport changes
// (mobile URL bar show/hide, rotation, on-screen keyboard, window resize, DPR
// change) so pointer coords keep mapping to where ink actually lands. Debounced
// so a burst of resize events only triggers one re-layout.
let resizeTimer = null;
const onViewportChange = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => app.resize(), 100);
};
window.addEventListener('resize', onViewportChange);
window.visualViewport?.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);

document.body.dataset.ready = 'true';
