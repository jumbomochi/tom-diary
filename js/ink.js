// Pure geometry + stroke model for the ink surface. No DOM at module scope.

import { createIdleTimer, computeCommitBox, renderCommitPng } from './commit.js';
import { looksLikeExclamation } from './help.js';

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
  let current = null;
  return {
    get strokes() { return strokes; },
    begin(pt) { current = { points: [pt] }; },
    extend(pt) { if (current) current.points.push(pt); },
    end() { if (current && current.points.length) strokes.push(current); current = null; },
    erase(x, y, r) { strokes = eraseStrokes(strokes, x, y, r); },
    clear() { strokes = []; current = null; },
  };
}

const PAPER = '#f4ecd8';
const INK = '#33302a';
const PRESSURE_GATE = 0.01; // ~ (>40 of 4096) from riddle main.rs:327

export function initInk(canvas, { onCommit, onHelp, idleMs = 2800, gate } = {}) {
  const inkGate = gate || { accepts: () => true, onBlockedTap: () => {} };
  const ctx = canvas.getContext('2d');
  const store = createStrokeStore();
  let penDown = false;
  let activePointerId = null;
  let prevR = null;
  let livePts = [];
  let strokeStarted = false;

  const cssW = () => canvas.clientWidth;
  const cssH = () => canvas.clientHeight;

  function repaint() {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, cssW(), cssH());
    ctx.fillStyle = INK;
    for (const s of store.strokes) drawStroke(s.points);
  }
  function drawStroke(points) {
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r ?? 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const timer = createIdleTimer(idleMs, onIdle);

  function onIdle() {
    if (looksLikeExclamation(store.strokes, cssH())) {
      store.clear();
      repaint();
      if (onHelp) onHelp();
      return;
    }
    const box = computeCommitBox(store.strokes, cssW(), cssH());
    if (!box) return; // empty / fully erased
    const uri = renderCommitPng(store.strokes, box);
    const snapshot = store.strokes.map((s) => ({ points: s.points.slice() }));
    if (onCommit) onCommit(uri, snapshot);
  }

  function feed(e) {
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    if (e.pointerType === 'pen' && pressure < PRESSURE_GATE) return; // wait for real contact
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = pressureToRadius(pressure, prevR);
    prevR = r;
    const pt = { x, y, r };
    livePts.push(pt);
    if (!strokeStarted) { store.begin(pt); strokeStarted = true; } else { store.extend(pt); }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function endStroke(e, cancelled) {
    if (!penDown || e.pointerId !== activePointerId) return;
    penDown = false;
    try { canvas.releasePointerCapture(activePointerId); } catch (_) { /* not captured */ }
    activePointerId = null;
    if (cancelled) {
      if (strokeStarted) repaint(); // drop the partial in-flight stroke's pixels
    } else if (strokeStarted) {
      if (isEraserStroke(livePts)) {
        for (const p of livePts) store.erase(p.x, p.y, 22);
        repaint();
      } else {
        store.end();
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
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture unsupported */ }
    prevR = null;
    livePts = [];
    strokeStarted = false;
    timer.penDown();
    feed(e); // may no-op if the first pen sample is below the pressure gate
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!penDown || e.pointerId !== activePointerId) return;
    feed(e);
    timer.activity();
  });
  canvas.addEventListener('pointerup', (e) => endStroke(e, false));
  canvas.addEventListener('pointercancel', (e) => endStroke(e, true));

  repaint();
  return { store };
}
