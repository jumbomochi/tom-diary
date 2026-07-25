// Pure geometry + stroke model for the ink surface. No DOM at module scope.

import { createIdleTimer, computeCommitBox, renderCommitPng } from './commit.js';
import { looksLikeExclamation } from './help.js';
import { renderStroke } from './render-stroke.js';

/**
 * Pressure→radius, ported from riddle main.rs:345 (normalized) + ink.rs:41 (growth cap).
 * @param {number} pressure normalized 0..1
 * @param {number|null} prevR previous point's radius, for growth smoothing
 */
export function pressureToRadius(pressure, prevR = null) {
  let r = 2 + pressure * 3;
  if (r < 2) r = 2;
  if (r > 5) r = 5;
  if (prevR != null) r = Math.min(r, prevR + 1);
  return r;
}

/**
 * Classify a stroke as a scribble-erase gesture: many horizontal direction
 * reversals packed into a short path. tom-diary original (riddle used a
 * hardware eraser).
 */
export function isEraserStroke(points, { minReversals = 4, minReversalsPerPx = 0.02 } = {}) {
  if (points.length < 4) return false;
  let pathLen = 0;
  let reversals = 0;
  let prevDir = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    pathLen += Math.hypot(dx, dy);
    const dir = Math.sign(dx);
    if (dir !== 0) {
      if (prevDir !== 0 && dir !== prevDir) reversals++;
      prevDir = dir;
    }
  }
  if (pathLen === 0) return false;
  return reversals >= minReversals && reversals / pathLen >= minReversalsPerPx;
}

export function eraseStrokes(strokes, ex, ey, radius) {
  const rr = (radius + 2) ** 2;
  const out = [];
  for (const stroke of strokes) {
    let cur = [];
    for (const p of stroke.points) {
      const d2 = (p.x - ex) ** 2 + (p.y - ey) ** 2;
      if (d2 <= rr) {
        if (cur.length) { out.push({ points: cur }); cur = []; }
      } else {
        cur.push(p);
      }
    }
    if (cur.length) out.push({ points: cur });
  }
  return out;
}

export function isPageEmpty(strokes) {
  return strokes.reduce((n, s) => n + s.points.length, 0) === 0;
}

export function createStrokeStore() {
  let strokes = [];
  return {
    get strokes() { return strokes; },
    push(stroke) { strokes.push(stroke); },
    erase(x, y, r) { strokes = eraseStrokes(strokes, x, y, r); },
    clear() { strokes = []; },
  };
}

const PAPER = '#f4ecd8';
const PRESSURE_GATE = 0.01; // ~ (>40 of 4096) from riddle main.rs:327

export function initInk(canvas, { onCommit, onHelp, idleMs = 2800, gate } = {}) {
  const inkGate = gate || { accepts: () => true, onBlockedTap: () => {} };
  const ctx = canvas.getContext('2d');
  const store = createStrokeStore();

  // Offscreen buffer holding paper + committed ink. Composited to the main
  // canvas each frame while drawing; the in-progress stroke is drawn on main
  // on top of it. perfect-freehand recomputes the whole stroke outline as it
  // grows (the tail tapers), so we cannot additively paint — we redraw the
  // committed layer under the live stroke every frame.
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');

  const cssW = () => canvas.clientWidth;
  const cssH = () => canvas.clientHeight;
  const dpr = () => window.devicePixelRatio || 1;

  function fillPaper(c) { c.fillStyle = PAPER; c.fillRect(0, 0, cssW(), cssH()); }

  function sizeLayer() {
    layer.width = canvas.width;   // device px, mirrors the main backing store
    layer.height = canvas.height;
    lctx.setTransform(dpr(), 0, 0, dpr(), 0, 0); // draw in CSS px
  }

  // Rebuild the offscreen buffer from the store: paper + every committed stroke.
  function rebuildLayer() {
    fillPaper(lctx);
    for (const s of store.strokes) {
      renderStroke(lctx, s.points, { simulatePressure: !s.pen, last: true });
    }
  }

  // Copy the offscreen buffer onto main 1:1 in device pixels, bypassing main's
  // DPR transform (getImage-style blit, so it is not double-scaled).
  function blit() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  function repaint() { rebuildLayer(); blit(); }          // after erase / resize
  function clearInk() { store.clear(); fillPaper(lctx); }  // reset buffer; main left for the drink dissolve
  function resize() { sizeLayer(); repaint(); }

  sizeLayer();
  fillPaper(lctx);

  let penDown = false;
  let activePointerId = null;
  let livePts = [];
  let strokeStarted = false;
  let penKind = false;      // true when the active stroke is a real pen
  let rafPending = false;

  function scheduleFrame() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!strokeStarted || livePts.length === 0) return;
      blit(); // committed layer as the backdrop
      renderStroke(ctx, livePts, { simulatePressure: !penKind, last: false });
    });
  }

  // Append one sample to the live stroke. Returns false if the pen sample is
  // below the contact-pressure gate (so we wait for real contact).
  function pushSample(e) {
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    if (e.pointerType === 'pen' && pressure < PRESSURE_GATE) return false;
    const rect = canvas.getBoundingClientRect();
    livePts.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, pressure });
    strokeStarted = true;
    return true;
  }

  const timer = createIdleTimer(idleMs, onIdle);

  function onIdle() {
    if (looksLikeExclamation(store.strokes, cssH())) {
      clearInk();
      blit();
      if (onHelp) onHelp();
      return;
    }
    const box = computeCommitBox(store.strokes, cssW(), cssH());
    if (!box) return; // empty / fully erased
    const uri = renderCommitPng(store.strokes, box);
    const snapshot = store.strokes.map((s) => ({ points: s.points.slice() }));
    if (onCommit) onCommit(uri, snapshot);
  }

  function endStroke(e, cancelled) {
    if (!penDown || e.pointerId !== activePointerId) return;
    penDown = false;
    try { canvas.releasePointerCapture(activePointerId); } catch (_) { /* not captured */ }
    activePointerId = null;
    // Drop the in-flight stroke on cancel, or if ink became suppressed mid-stroke
    // (e.g. Settings opened, clearing the store) — the store no longer holds the
    // active stroke, so clearing it can't cancel this capture; the gate does.
    if (cancelled || !inkGate.accepts()) {
      if (strokeStarted) blit(); // drop the in-flight stroke's pixels
    } else if (strokeStarted && livePts.length) {
      if (isEraserStroke(livePts)) {
        for (const p of livePts) store.erase(p.x, p.y, 22);
        repaint();
      } else {
        store.push({ points: livePts.slice(), pen: penKind });
        renderStroke(lctx, livePts, { simulatePressure: !penKind, last: true });
        blit();
      }
    }
    livePts = [];
    strokeStarted = false;
    timer.penUp();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (penDown) return; // ignore secondary/concurrent pointers (palm, 2nd finger)
    if (!inkGate.accepts()) { inkGate.onBlockedTap(); return; } // only Listening writes ink
    penDown = true;
    activePointerId = e.pointerId;
    penKind = e.pointerType === 'pen';
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture unsupported */ }
    livePts = [];
    strokeStarted = false;
    timer.penDown();
    pushSample(e); // may no-op if the first pen sample is below the pressure gate
    scheduleFrame();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!penDown || e.pointerId !== activePointerId) return;
    const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const s of (samples.length ? samples : [e])) pushSample(s);
    timer.activity();
    scheduleFrame();
  });
  canvas.addEventListener('pointerup', (e) => endStroke(e, false));
  canvas.addEventListener('pointercancel', (e) => endStroke(e, true));

  blit(); // show the (empty) paper buffer
  return { store, repaint, clearInk, resize };
}
