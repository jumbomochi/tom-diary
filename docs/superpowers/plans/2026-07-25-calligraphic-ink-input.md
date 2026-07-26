# Calligraphic Ink Input + Coordinate-Offset Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the loose-disc input ink with continuous, variable-width calligraphic strokes (perfect-freehand), and fix the cursor↔ink coordinate offset that appears after any viewport change.

**Architecture:** Keep the point model canonical (each stroke is `{ points: [{x,y,pressure}], pen }`); change only *rendering*. A shared `renderStroke` fills a perfect-freehand outline and is used for both on-screen ink and the committed PNG. An offscreen `inkLayer` canvas holds committed strokes; each animation frame while drawing it is blitted to the main canvas and the in-progress stroke is drawn on top. A debounced resize handler re-sizes both canvases, re-applies the DPR transform, and repaints.

**Tech Stack:** Vanilla ES modules (no build step), Canvas 2D, `perfect-freehand` (vendored ESM), vitest (unit), Playwright (browser), PWA service worker.

## Global Constraints

- No build step. New deps are vendored as a single self-contained ESM file under `vendor/` and imported by relative path (same pattern as `vendor/opentype.mjs`).
- The point model stays canonical: `eraseStrokes`, `computeCommitBox`, `strokesToTriples` (memory), and conjure must keep working unchanged. Do **not** rewrite them.
- On-screen ink color is `#33302a` (`INK`); paper is `#f4ecd8` (`PAPER`). The committed PNG sent to the oracle is **pure black `#000000` on white `#ffffff`** (the vision model needs high contrast).
- Any new precached asset must be added to `sw.js`'s `SHELL` array **and** the cache name bumped (`tom-diary-v1` → `tom-diary-v2`) so returning PWA users receive the new shell.
- Test commands: `npm test` (vitest, unit) and `npm run test:browser` (Playwright). Single browser spec: `npx playwright test tests/browser/<file>.spec.js`.

---

### Task 1: Vendor perfect-freehand + shared `renderStroke`

**Files:**
- Create: `vendor/perfect-freehand.mjs`
- Create: `js/render-stroke.js`
- Create: `tests/unit/render-stroke.test.js`
- Modify: `sw.js` (SHELL array + cache name)

**Interfaces:**
- Produces: `strokeOutline(points, opts) -> Array<[number,number]>` and `renderStroke(ctx, points, opts) -> void` from `js/render-stroke.js`. `points` are `{x, y, pressure}`. `opts` = `{ simulatePressure?: boolean, last?: boolean, color?: string }`. Also exports `STROKE_OPTIONS`.

- [ ] **Step 1: Vendor the library as a single flattened ESM file**

Run:
```bash
cd /Users/huiliang/GitHub/hp-diary/tom-diary
curl -fsSL "https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.2/+esm" -o vendor/perfect-freehand.mjs
# Verify it is self-contained (no bare/relative imports that would 404 at runtime):
grep -nE "^\s*(import|export)[^;]*from\s+['\"]" vendor/perfect-freehand.mjs | grep -vE "from ['\"]\./" || echo "OK: no external imports"
grep -c "getStroke" vendor/perfect-freehand.mjs
```
Expected: the `grep -vE` line prints `OK: no external imports` (jsDelivr `+esm` inlines all deps), and `getStroke` appears. If the file contains a relative `import ... from './...'`, re-fetch with the `?bundle` form: `curl -fsSL "https://esm.sh/perfect-freehand@1.2.2?bundle" -o vendor/perfect-freehand.mjs` and re-verify.

- [ ] **Step 2: Write the failing test for `strokeOutline`**

Create `tests/unit/render-stroke.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { strokeOutline } from '../../js/render-stroke.js';

describe('strokeOutline', () => {
  it('returns a non-empty closed polygon of [x,y] points for a multi-point stroke', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 5, pressure: 0.5 },
    ];
    const out = strokeOutline(pts, { simulatePressure: true, last: true });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toHaveLength(2);
  });

  it('yields an outline for a single point (a dot)', () => {
    const out = strokeOutline([{ x: 5, y: 5, pressure: 0.5 }], { last: true });
    expect(out.length).toBeGreaterThan(0);
  });

  it('defaults missing pressure to 0.5 without throwing', () => {
    const out = strokeOutline([{ x: 0, y: 0 }, { x: 4, y: 4 }], {});
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- render-stroke`
Expected: FAIL — `Failed to resolve import "../../js/render-stroke.js"` (module does not exist yet).

- [ ] **Step 4: Implement `js/render-stroke.js`**

Create `js/render-stroke.js`:
```javascript
// Shared calligraphic stroke renderer. Wraps perfect-freehand's getStroke to
// turn a stroke's input points into a filled, variable-width outline. Used by
// the on-screen ink (ink.js) and the committed PNG (commit.js) so both look
// identical.
import { getStroke } from '../vendor/perfect-freehand.mjs';

const INK = '#33302a';

// Tuned for the diary's ink weight on cream paper. `size` is the nib diameter
// in CSS px; `thinning` sets how strongly pressure/velocity vary the width.
export const STROKE_OPTIONS = {
  size: 7,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.4,
  easing: (t) => t,
};

/**
 * Pure: input points -> closed outline polygon (array of [x, y]).
 * `points` are {x, y, pressure}. `simulatePressure` derives width from velocity
 * when there is no real pen pressure (finger/mouse). `last` closes the tail
 * taper for a completed stroke.
 */
export function strokeOutline(points, { simulatePressure = true, last = false } = {}) {
  const input = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  return getStroke(input, { ...STROKE_OPTIONS, simulatePressure, last });
}

/** Fill one stroke's calligraphic outline onto ctx. Color defaults to INK. */
export function renderStroke(ctx, points, opts = {}) {
  if (!points || points.length === 0) return;
  const outline = strokeOutline(points, opts);
  if (outline.length < 2) return;
  ctx.fillStyle = opts.color || INK;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
  ctx.closePath();
  ctx.fill();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- render-stroke`
Expected: PASS (3 tests).

- [ ] **Step 6: Precache the vendor file + bump the SW cache**

In `sw.js`, add `'./vendor/perfect-freehand.mjs'` to the `SHELL` array (next to `'./vendor/opentype.mjs'`), and change the cache constant:
```javascript
const CACHE = 'tom-diary-v2';
```
(from `'tom-diary-v1'`).

- [ ] **Step 7: Commit**

```bash
git add vendor/perfect-freehand.mjs js/render-stroke.js tests/unit/render-stroke.test.js sw.js
git commit -m "feat: vendor perfect-freehand + shared renderStroke; bump SW cache v2"
```

---

### Task 2: Calligraphic ink in `ink.js` (pressure capture, offscreen layer, live-draw loop)

**Files:**
- Modify: `js/ink.js`
- Test: `tests/browser/ink-surface.spec.js`, `tests/browser/ink-gate.spec.js` (must still pass; no edits expected)

**Interfaces:**
- Consumes: `renderStroke` from `js/render-stroke.js` (Task 1).
- Produces: `initInk(canvas, opts) -> { store, repaint, clearInk, resize }`. `store.strokes` are `{ points: [{x,y,pressure}], pen }`. `clearInk()` resets the offscreen buffer and store but leaves the main canvas untouched (so the drink dissolve can animate the real ink away). `repaint()` rebuilds from the store and blits to main. `resize()` re-sizes the offscreen layer to the main canvas and repaints. `createStrokeStore` gains `push(stroke)` (replacing `begin/extend/end`). `pressureToRadius` is retained as an exported pure helper (its unit test stays green); the input path no longer calls it. `memory.js` is left untouched — `strokesToTriples` reads `p.r ?? 2`, which now yields a uniform nominal radius that conjure ignores (conjure replays at a fixed radius), so persistence/recall are unaffected.

- [ ] **Step 1: Run the existing ink specs to establish a green baseline**

Run: `npx playwright test tests/browser/ink-surface.spec.js tests/browser/ink-gate.spec.js`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Add a characterization unit test for `eraseStrokes` (lock erase behavior across the rewrite)**

Create `tests/unit/ink-erase.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { eraseStrokes, isEraserStroke } from '../../js/ink.js';

describe('eraseStrokes', () => {
  it('removes points within the eraser radius and splits the stroke', () => {
    const strokes = [{ points: [
      { x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0.5 }, { x: 30, y: 0, pressure: 0.5 },
    ] }];
    // Erase around x=10..20 -> the stroke splits into the surviving ends.
    const out = eraseStrokes(strokes, 15, 0, 8);
    const survivingX = out.flatMap((s) => s.points.map((p) => p.x));
    expect(survivingX).toContain(0);
    expect(survivingX).toContain(30);
    expect(survivingX).not.toContain(10);
    expect(survivingX).not.toContain(20);
  });

  it('leaves strokes fully outside the radius untouched', () => {
    const strokes = [{ points: [{ x: 100, y: 100, pressure: 0.5 }, { x: 120, y: 100, pressure: 0.5 }] }];
    const out = eraseStrokes(strokes, 0, 0, 10);
    expect(out).toHaveLength(1);
    expect(out[0].points).toHaveLength(2);
  });
});

describe('isEraserStroke', () => {
  it('classifies a tight back-and-forth scribble as an erase gesture', () => {
    const pts = [];
    for (let i = 0; i < 12; i++) pts.push({ x: 100 + (i % 2 === 0 ? 0 : 6), y: 100 });
    expect(isEraserStroke(pts)).toBe(true);
  });
});
```
Run: `npm test -- ink-erase`
Expected: PASS (these assert current behavior; they guard the rewrite).

- [ ] **Step 3: Rewrite the rendering + capture internals of `initInk`**

In `js/ink.js`:

(a) Add the import at the top (after the existing imports):
```javascript
import { renderStroke } from './render-stroke.js';
```

(b) In `createStrokeStore`, replace the `begin`/`extend`/`end` methods with a `push` method (keep `strokes`, `erase`, `clear`):
```javascript
export function createStrokeStore() {
  let strokes = [];
  return {
    get strokes() { return strokes; },
    push(stroke) { strokes.push(stroke); },
    erase(x, y, r) { strokes = eraseStrokes(strokes, x, y, r); },
    clear() { strokes = []; },
  };
}
```

(c) Remove the now-unused module-private `const INK = '#33302a';` line in `js/ink.js` (the old disc renderer used it; `render-stroke.js` owns the ink color now). Keep `PAPER` and `PRESSURE_GATE`.

(d) Replace the entire body of `initInk` (everything inside the function) with the following. Keep the exported helpers above it (`pressureToRadius`, `isEraserStroke`, `eraseStrokes`, `isPageEmpty`, `createStrokeStore`, and the `PAPER`/`PRESSURE_GATE` constants) unchanged, except `createStrokeStore` per (b):
```javascript
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
    if (cancelled) {
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
```

- [ ] **Step 4: Run the ink specs — verify behavior is preserved**

Run: `npx playwright test tests/browser/ink-surface.spec.js tests/browser/ink-gate.spec.js`
Expected: PASS. These assert on `store.strokes.length`, commit firing, the help gesture, pointercancel recovery, and gating — none read point `.r`, so they should be green with the new `{x,y,pressure}` model and push-at-pen-up flow.

- [ ] **Step 5: Run the full unit + browser suite for regressions**

Run: `npm test && npm run test:browser`
Expected: PASS (including the new `ink-erase` unit test), except possibly `commit-render.spec.js` (renderCommitPng still stamps discs at radius 2 here because points now carry `pressure` not `r`; it still yields black-on-white, so it should pass — it is finalized in Task 3). If any spec that reads a point's `.r` fails, that is a real coupling to fix; note it.

- [ ] **Step 6: Commit**

```bash
git add js/ink.js tests/unit/ink-erase.test.js
git commit -m "feat: calligraphic ink via offscreen layer + perfect-freehand; store pressure per point"
```

---

### Task 3: Committed PNG uses `renderStroke`

**Files:**
- Modify: `js/commit.js` (`renderCommitPng`)
- Test: `tests/browser/commit-render.spec.js`

**Interfaces:**
- Consumes: `renderStroke` from `js/render-stroke.js`. `computeCommitBox` is unchanged (it reads `p.r ?? 2`, which now defaults to a nominal 2; the existing 20px pad covers the outline width).

- [ ] **Step 1: Update `renderCommitPng` to render calligraphic strokes**

In `js/commit.js`, add the import at the top:
```javascript
import { renderStroke } from './render-stroke.js';
```
Replace the whole `renderCommitPng` function body with:
```javascript
export function renderCommitPng(strokes, box) {
  const canvas = document.createElement('canvas');
  canvas.width = box.outW;
  canvas.height = box.outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Map full-resolution stroke coords into the downscaled box: px -> (px-x0)/f.
  const f = box.factor;
  ctx.setTransform(1 / f, 0, 0, 1 / f, -box.x0 / f, -box.y0 / f);
  for (const s of strokes) {
    renderStroke(ctx, s.points, { color: '#000000', simulatePressure: !s.pen, last: true });
  }
  return canvas.toDataURL('image/png');
}
```

- [ ] **Step 2: Update the commit-render sample points to the pressure model**

In `tests/browser/commit-render.spec.js`, change both stroke literals from `r`-based points to pressure points (two occurrences):
```javascript
    const strokes = [{ points: [
      { x: 100, y: 100, pressure: 0.5 }, { x: 200, y: 100, pressure: 0.5 }, { x: 300, y: 100, pressure: 0.5 },
    ] }];
```
(The assertions — PNG data URI, positive dimensions, white corner, at least one dark pixel — stay the same.)

- [ ] **Step 3: Run the commit-render spec**

Run: `npx playwright test tests/browser/commit-render.spec.js`
Expected: PASS — the PNG is a valid data URI with a white corner and dark (`#000000`) ink pixels from the freehand fill.

- [ ] **Step 4: Commit**

```bash
git add js/commit.js tests/browser/commit-render.spec.js
git commit -m "feat: committed PNG uses shared calligraphic renderStroke (black on white)"
```

---

### Task 4: Coordinate-offset fix — resize wiring

**Files:**
- Modify: `js/app.js` (export `sizeCanvasBacking`, add `app.resize`, wire `clearInk`/`clearScreen` to the offscreen layer)
- Modify: `js/app-boot.js` (use `sizeCanvasBacking`; add debounced resize listeners)

**Interfaces:**
- Produces: `sizeCanvasBacking(canvas) -> number` (dpr) from `js/app.js`; `app.resize()` on the object returned by `initApp`.
- Consumes: `initInk(...)` now returns `{ store, repaint, clearInk, resize }` (Task 2).

- [ ] **Step 1: Export a shared backing-store sizer from `app.js`**

In `js/app.js`, add near the top (after imports, before `initApp`):
```javascript
/** Size a canvas's backing store to its CSS box at the current DPR, and apply
 *  the matching draw transform. Returns the DPR used. */
export function sizeCanvasBacking(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}
```

- [ ] **Step 2: Wire `clearInk`/`clearScreen` to the offscreen layer and expose `app.resize`**

In `js/app.js`, `initApp`:

(a) The ink surface already returns `{ store, repaint, clearInk, resize }`. Capture it (the code assigns `app.store = inkSurface.store;` — keep the full handle):
```javascript
  const inkSurface = initInk(canvas, { /* ...existing options unchanged... */ });
  app.store = inkSurface.store;
```

(b) In `runEffect`, change the `clearInk` and `clearScreen` cases:
```javascript
      case 'clearInk': inkSurface.clearInk(); break;
      ...
      case 'clearScreen': inkSurface.clearInk(); paintPaper(); break;
```
(`clearInk` resets the offscreen buffer + store but leaves main for the drink dissolve; `clearScreen` also repaints main paper for the fresh page.)

(c) Add a `resize` method to the returned `app` object (just before `return app;`):
```javascript
  app.resize = () => {
    sizeCanvasBacking(canvas);   // re-size main + re-apply its DPR transform
    inkSurface.resize();         // re-size the offscreen layer + repaint the page
  };
```

- [ ] **Step 3: Replace `app-boot.js`'s one-shot sizing with a debounced live handler**

In `js/app-boot.js`:

(a) Update the import to pull in the sizer:
```javascript
import { initApp, sizeCanvasBacking } from './app.js';
```

(b) Replace the local `resize()` function and its single call:
```javascript
const canvas = document.getElementById('page');
sizeCanvasBacking(canvas);
```
(delete the old `function resize() {...}` and the bare `resize();`).

(c) After `app = initApp(...)` is assigned (near the end, before `document.body.dataset.ready`), register debounced viewport listeners:
```javascript
let resizeTimer = null;
const onViewportChange = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => app.resize(), 100);
};
window.addEventListener('resize', onViewportChange);
window.visualViewport?.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', onViewportChange);
```

- [ ] **Step 4: Run the app + smoke suites**

Run: `npm run test:browser -- app-e2e smoke ink-surface`
Expected: PASS. The turn cycle (write → commit → drink → reply → fade → listening) still works with the offscreen-layer `clearInk`/`clearScreen` wiring.

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/app-boot.js
git commit -m "fix: re-size canvas + offscreen layer on viewport change (cursor/ink offset)"
```

---

### Task 5: Offset regression test (Playwright)

**Files:**
- Create: `tests/browser/ink-resize.spec.js`

**Interfaces:**
- Consumes: the app harness `tests/browser/fixtures/app-harness.html` if it exposes the app, otherwise the ink harness. This test uses the real page (`/`) is not required; use the ink harness which sizes the canvas and exposes `window.__ink`. Because the ink harness sizes once (like the old boot), the test drives `app`-level resize only where available; here we validate the **layer resize + repaint** path via `window.__ink.resize()` and pixel checks.

- [ ] **Step 1: Add a resize hook to the ink harness**

In `tests/browser/fixtures/ink-harness.html`, after `window.__ink = ink;`, add a helper that mirrors the app's resize (re-size main backing store + call the ink surface resize):
```html
  window.__resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    ink.resize();
  };
```

- [ ] **Step 2: Write the failing regression test**

Create `tests/browser/ink-resize.spec.js`:
```javascript
import { test, expect } from '@playwright/test';

// Reads the pixel at CSS (x,y) on the main canvas; returns [r,g,b,a].
async function pixelAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const c = document.getElementById('page');
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

const isInk = ([r, g, b]) => r < 120 && g < 120 && b < 120; // sepia ink is dark-ish

test('ink lands under the pointer after a viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/tests/browser/fixtures/ink-harness.html?idle=99999');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // First stroke at the original size.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 200, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });

  // Change the viewport, then re-run the app-level resize.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.evaluate(() => window.__resize());

  // The earlier stroke survives the resize.
  expect(isInk(await pixelAt(page, 230, 200))).toBe(true);

  // A new stroke lands exactly under the pointer (no offset).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 150, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  // Give rAF a frame to paint the live stroke, then bake happens on pointerup.
  await page.waitForTimeout(50);
  expect(isInk(await pixelAt(page, 180, 400))).toBe(true);
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx playwright test tests/browser/ink-resize.spec.js`
Expected: PASS. If the mid-point pixel misses the thin stroke, widen the sample tolerance by checking a small neighborhood (±3px) rather than a single pixel — but the size-7 nib at pressure 0.6 should cover the sampled center.

- [ ] **Step 4: Full suite + commit**

Run: `npm test && npm run test:browser`
Expected: PASS across unit + browser suites.

```bash
git add tests/browser/ink-resize.spec.js tests/browser/fixtures/ink-harness.html
git commit -m "test: regression guard for cursor/ink offset after viewport resize"
```

---

## Manual verification (after all tasks)

1. `npm run serve`, open on a phone (or DevTools device mode). Write a fast stroke — it is continuous calligraphic ink, no dotted gaps.
2. Scroll to hide/show the mobile URL bar (or rotate), then write — ink lands exactly under the finger/pen (no offset). Prior ink survives.
3. Finger/mouse strokes taper with speed; pen strokes vary with pressure.
4. Scribble-erase still removes ink; the "!" gesture still opens help; a page still commits to the oracle and Tom replies.
5. Reload offline (DevTools → Offline) — the app still loads (SW `tom-diary-v2` shell includes the vendor file).
