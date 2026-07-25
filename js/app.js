// The driver: owns the canvas, writer, oracle, memory, settings, blot and
// timers; turns reducer effects into real work and real callbacks into events.
import { initInk } from './ink.js';
import { computeCommitBox } from './commit.js';
import { showHelpPanel } from './help.js';
import {
  createReplyWriter, runDissolve, DRINK_STAGES, DRINK_STEP_MS, FADE_STAGES, FADE_STEP_MS,
} from './handwriting.js';
import { createGlyphCache } from './glyphs.js';
import { createRevealAnimator, stampDot } from './reveal.js';
import { askOracle } from './oracle.js';
import { createMemoryStore, spokenDate, memoryEnabled } from './memory.js';
import { createSettingsStore, settingsToConfig } from './settings.js';
import {
  initialState, reduce, planConjure,
} from './statemachine.js';

const PAPER = '#f4ecd8';
const FADED = '#787878';

export function initApp(canvas, {
  deps = {}, db, font, settingsStore, idleMs = 2800, offsetHours = 0,
} = {}) {
  const ctx = canvas.getContext('2d');
  const cssW = () => canvas.clientWidth;
  const cssH = () => canvas.clientHeight;
  const paintPaper = () => { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cssW(), cssH()); };

  const memory = createMemoryStore(db, { offsetHours });
  const settings = settingsStore || createSettingsStore(db);
  const writer = createReplyWriter(canvas, font, { px: 96, color: '#000000' });
  const headProvider = createGlyphCache(font, 54);
  const replyProvider = createGlyphCache(font, 96);

  let state = initialState();
  const timers = new Map();
  let blotTimer = null;
  let dissolver = null;
  let savedImage = null;   // canvas snapshot for conjure restore
  let commitSnapshot = null; // strokes for persistence
  let currentConfig = null;
  let currentOffset = 0;
  let settingsOpen = false; // true while the Settings panel is up: ink is fully suppressed

  const clearTimer = (name) => { if (timers.has(name)) { clearTimeout(timers.get(name)); timers.delete(name); } };

  function dispatch(ev) {
    const out = reduce(state, ev);
    state = out.state;
    for (const eff of out.effects) runEffect(eff);
  }

  const app = { dispatch, getState: () => state, store: null };

  // Suspend/resume ink while the Settings panel is open. Opening also erases the
  // transient corner hold-dot the gesture leaves behind (clearing the store makes
  // computeCommitBox return null, so no idle commit / oracle turn can fire for it),
  // and repaints so nothing shows behind the panel.
  app.setSettingsOpen = (open) => {
    settingsOpen = open;
    if (open) { app.store.clear(); paintPaper(); }
  };

  // --- effect executors ---
  function runEffect(eff) {
    switch (eff.type) {
      case 'clearInk': app.store.clear(); break;
      case 'startOracle': startOracle(eff.uri); break;
      case 'dissolve': runDissolveEffect(eff.region, eff.kind); break;
      case 'blot': eff.on ? startBlot() : stopBlot(); break;
      case 'write': {
        const s = writer.write(eff.text, { onDone: () => dispatch({ type: 'revealDrained' }) });
        dispatch({ type: 'revealPlanned', totalPoints: s.totalPoints, region: s.region });
        break;
      }
      case 'append': {
        const s = writer.appendChunk(eff.text);
        dispatch({ type: 'revealPlanned', totalPoints: s.totalPoints, region: s.region });
        break;
      }
      case 'persist': persist(eff.id, eff.transcript, eff.reply); break;
      case 'conjure': conjure(eff.id); break;
      case 'restoreCanvas': restoreCanvas(); break;
      case 'clearScreen': paintPaper(); break;
      case 'openHelp':
        showHelpPanel(document.body, { onDismiss: () => dispatch({ type: 'helpDismissed' }) });
        break;
      case 'schedule':
        clearTimer(eff.name);
        timers.set(eff.name, setTimeout(() => { timers.delete(eff.name); dispatch({ type: 'timer', name: eff.name }); }, eff.ms));
        break;
      case 'cancelTimer': clearTimer(eff.name); break;
      default: break;
    }
  }

  function runDissolveEffect(region, kind) {
    if (dissolver) dissolver.cancel();
    const [stages, stepMs, done] = kind === 'drink'
      ? [DRINK_STAGES, DRINK_STEP_MS, 'drinkDone']
      : [FADE_STAGES, FADE_STEP_MS, 'fadeDone'];
    dissolver = runDissolve(ctx, region, { stages, stepMs, paper: PAPER, onDone: () => { dissolver = null; dispatch({ type: done }); } });
  }

  async function startOracle(uri) {
    const s = await settings.load();
    currentConfig = settingsToConfig(s);
    currentOffset = s.tzOffset;
    const remember = currentConfig.remember;
    const cat = remember ? await memory.catalog(50) : { lines: [], ids: [] };
    const history = remember ? await memory.recentDialogue(6) : [];
    if (!currentConfig.key) { dispatch({ type: 'oracleError', text: 'no oracle' }); dispatch({ type: 'oracleEnd' }); return; }
    const handlers = {
      onInk: (t) => dispatch({ type: 'oracleInk', text: t }),
      onShow: (id) => dispatch({ type: 'oracleShow', id }),
      onTranscript: (t) => dispatch({ type: 'oracleTranscript', text: t }),
      onError: (t) => dispatch({ type: 'oracleError', text: t }),
    };
    const turn = { imageDataUri: uri, history, catalogLines: cat.lines, catalogIds: cat.ids };
    try { await askOracle(currentConfig, turn, handlers, deps); }
    finally { dispatch({ type: 'oracleEnd' }); }
  }

  async function persist(id, transcript, reply) {
    const s = await settings.load();
    if (!memoryEnabled(s.memory)) return;
    await memory.append(id, transcript, reply, commitSnapshot || []);
  }

  // --- the thinking blot ---
  function startBlot() {
    stopBlot();
    let on = false;
    const cx = cssW() / 2, cy = cssH() / 2;
    const tick = () => {
      if (on) { ctx.fillStyle = PAPER; ctx.fillRect(cx - 14, cy - 14, 28, 28); }
      else stampDot(ctx, cx, cy, 9, '#000000');
      on = !on;
      blotTimer = setTimeout(tick, 600);
    };
    tick();
  }
  function stopBlot() {
    if (blotTimer) { clearTimeout(blotTimer); blotTimer = null; }
    const cx = cssW() / 2, cy = cssH() / 2;
    ctx.fillStyle = PAPER; ctx.fillRect(cx - 14, cy - 14, 28, 28);
  }

  // --- conjure ---
  async function conjure(id) {
    const entry = await memory.get(id);
    if (!entry) { dispatch({ type: 'oracleError', text: 'lost page' }); dispatch({ type: 'oracleEnd' }); return; }
    const strokes = (await memory.strokes(id)) || [];
    savedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    paintPaper();
    const plan = planConjure(headProvider, replyProvider, {
      id, reply: entry.reply, dateText: spokenDate(id, currentOffset), strokes,
    }, { screenW: cssW(), screenH: cssH() });
    const anim = createRevealAnimator(ctx, {
      pointsPerTick: 48, tickMs: 10, radius: 2, color: FADED,
      onDone: () => dispatch({ type: 'conjureDrained' }),
    });
    anim.setPlan(plan.strokes);
    anim.start();
  }
  function restoreCanvas() {
    if (savedImage) { ctx.putImageData(savedImage, 0, 0); savedImage = null; }
  }

  // --- input surface (gated to Listening; taps in other states dismiss) ---
  const inkSurface = initInk(canvas, {
    idleMs,
    onCommit: (uri, snapshot) => {
      commitSnapshot = snapshot;
      const box = computeCommitBox(snapshot, cssW(), cssH());
      const region = box ? { x0: box.x0, y0: box.y0, x1: box.x0 + box.w, y1: box.y0 + box.h } : { x0: 0, y0: 0, x1: cssW(), y1: cssH() };
      dispatch({ type: 'commit', uri, region, id: Math.floor(Date.now() / 1000) });
    },
    onHelp: () => dispatch({ type: 'help' }),
    gate: {
      accepts: () => !settingsOpen && state.name === 'listening',
      onBlockedTap: () => { if (!settingsOpen) dispatch({ type: 'penTap' }); },
    },
  });
  app.store = inkSurface.store;

  paintPaper();
  return app;
}
