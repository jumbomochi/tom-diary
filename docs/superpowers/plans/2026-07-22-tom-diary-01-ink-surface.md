# tom-diary Plan 1 — Foundation & Ink Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the tom-diary repo and the local, offline writing surface — you can write ink with a pen/finger, scribble to erase, rest the pen to commit the page to a PNG, and draw a large "!" to open a help panel — with no LLM involved yet.

**Architecture:** Vanilla ES-module JS, no build step for the shipped app. Each module exports **pure functions** (geometry, classification, timing, layout math) that are unit-tested with Vitest, plus a thin `init*(canvas, …)` wiring layer that touches the DOM/canvas and is smoke-tested with Playwright in a real browser. This split keeps the hard logic fast to test without a browser while still exercising canvas/Pointer Events for real.

**Tech Stack:** ES modules, HTML `<canvas>`, Pointer Events, Vitest + jsdom (unit), `@playwright/test` (browser smoke). Dev-only dependencies; the app itself ships as static files.

## Global Constraints

These apply to every task. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tom-diary-web-port-design.md`) and must not drift.

- **No build step for the shipped app.** `js/*.js` are ES modules loaded directly by `index.html` via `<script type="module">`. Vitest/Playwright are dev dependencies only; nothing compiles the app.
- **Pure logic is separated from DOM wiring** in every module: exported pure functions must be importable under jsdom without creating a canvas or touching `window` at module top-level. DOM work happens only inside `init*()` functions called by the app.
- **Ported constants (do not change):** `IDLE_COMMIT = 2800` ms; commit padding = **20 px** per side; downscale factor `= max(ceil(longSide / 800), 2)` (**minimum 2×**); pressure→radius `r = 2 + pressure*3` clamped to **[2, 5]** with per-point growth capped at `prevR + 1`; committed PNG is **black ink on white** (not the cream paper color).
- **Help gesture is a tom-diary original, not a port:** a large "!" whose main stroke is **≥ 20% of the active canvas height**. Sized relative to the canvas, never in absolute device pixels.
- **Coordinates are CSS pixels** in the canvas's own coordinate space (set `canvas.width/height` to `clientWidth/clientHeight × devicePixelRatio` and scale the context, so geometry math is DPI-independent).
- **Warm paper theme:** cream background `#f4ecd8`, dark warm-gray ink `#33302a`. (Committed PNG still uses pure black-on-white per above.)

---

## Plan sequence (context for the reviewer)

This is plan **1 of 4**. The full app is delivered as four sequenced plans, each producing working, testable software:

1. **Foundation & ink surface (this plan)** — repo + write/erase/commit/help, fully local.
2. **Handwriting synthesis** — `handwriting.js`: glyph rasterize → Zhang-Suen thin → trace to centerline polylines (cached per char+size) → animated brush reveal + dissolve; `plan_reply` layout/wobble.
3. **Oracle & memory** — `oracle.js` (request builder, PERSONA/MEMORY_PROTOCOL, SSE `StreamParser`, error/`max_completion_tokens` handling) and `memory.js` (IndexedDB store, decimation, catalog, `spoken_date`, prune, `recent_dialogue`, conjure lookup).
4. **App integration, settings & PWA** — `app.js` 9-state machine wiring everything, `settings.js`, `manifest.webmanifest`, `sw.js`, GitHub Pages deploy.

Plans 2–4 will be written (with concrete `Consumes` signatures) once this plan is executed, because their interfaces depend on the real exports produced here.

---

## File structure (this plan)

- `package.json` — dev deps + scripts (`test`, `test:browser`).
- `vitest.config.js` — jsdom env, unit tests under `tests/unit/`.
- `playwright.config.js` — browser smoke tests under `tests/browser/`, served from repo root.
- `.gitignore` — `node_modules/`, `test-results/`, `playwright-report/`.
- `index.html` — full-screen canvas + module entry.
- `css/paper.css` — warm paper theme, full-screen no-scroll layout.
- `js/ink.js` — **pure:** `pressureToRadius`, `isEraserStroke`, `eraseStrokes`, `isPageEmpty`, `createStrokeStore`; **wiring:** `initInk`.
- `js/commit.js` — **pure:** `createIdleTimer`, `computeCommitBox`; **wiring:** `renderCommitPng`.
- `js/help.js` — **pure:** `looksLikeExclamation`, `HELP_LINES`; **wiring:** `showHelpPanel`, `dismissHelpPanel`.
- `tests/unit/*.test.js` — Vitest specs.
- `tests/browser/*.spec.js` — Playwright specs.

> Note: `js/strokes` logic lives inside `js/ink.js` (exported) rather than a separate file, matching the spec's file list; it stays testable because the pure functions have no DOM dependency.

---

### Task 1: Repo scaffold and test harness

Stand up tooling and prove both test runners work before writing any app logic.

**Files:**
- Create: `tom-diary/package.json`
- Create: `tom-diary/vitest.config.js`
- Create: `tom-diary/playwright.config.js`
- Create: `tom-diary/.gitignore`
- Create: `tom-diary/index.html`
- Create: `tom-diary/css/paper.css`
- Create: `tom-diary/tests/unit/smoke.test.js`
- Create: `tom-diary/tests/browser/smoke.spec.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (Vitest) and `npm run test:browser` (Playwright) as the commands every later task uses.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "tom-diary",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:browser": "playwright test",
    "serve": "python3 -m http.server 8080"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "@playwright/test": "^1.48.0"
  }
}
```

- [ ] **Step 2: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Write `playwright.config.js`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  use: { baseURL: 'http://localhost:8080' },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
test-results/
playwright-report/
```

- [ ] **Step 5: Write a minimal `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <title>The Diary</title>
  <link rel="stylesheet" href="css/paper.css" />
</head>
<body>
  <canvas id="page"></canvas>
  <script type="module" src="js/app-boot.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write `css/paper.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }
body { background: #f4ecd8; }
#page { display: block; width: 100vw; height: 100vh; touch-action: none; }
```

- [ ] **Step 7: Write a temporary boot file so `index.html` loads without 404**

Create `tom-diary/js/app-boot.js`:

```js
// Temporary boot stub for Plan 1; replaced by app.js in Plan 4.
const canvas = document.getElementById('page');
const dpr = window.devicePixelRatio || 1;
canvas.width = canvas.clientWidth * dpr;
canvas.height = canvas.clientHeight * dpr;
canvas.getContext('2d').scale(dpr, dpr);
document.body.dataset.ready = 'true';
```

- [ ] **Step 8: Write the Vitest smoke test**

Create `tom-diary/tests/unit/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';

describe('harness', () => {
  it('runs unit tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Write the Playwright smoke test**

Create `tom-diary/tests/browser/smoke.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('page boots and canvas fills the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const box = await page.locator('#page').boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(100);
});
```

- [ ] **Step 10: Install and run both harnesses**

Run:
```bash
cd tom-diary && npm install && npx playwright install chromium
npm test
npm run test:browser
```
Expected: `npm test` → 1 passed. `npm run test:browser` → 1 passed.

- [ ] **Step 11: Commit**

```bash
cd tom-diary
git add -A
git commit -m "chore: scaffold repo, Vitest + Playwright harness, canvas shell"
```

---

### Task 2: Pressure → radius mapping

**Files:**
- Create: `tom-diary/js/ink.js`
- Test: `tom-diary/tests/unit/ink-pressure.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `pressureToRadius(pressure: number, prevR?: number|null): number` — `pressure` is the normalized 0..1 Pointer Events value; returns a radius in [2, 5], growth-capped at `prevR + 1` when `prevR` is given.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { pressureToRadius } from '../../js/ink.js';

describe('pressureToRadius', () => {
  it('maps 0 pressure to the minimum radius 2', () => {
    expect(pressureToRadius(0)).toBe(2);
  });
  it('maps full pressure to the maximum radius 5', () => {
    expect(pressureToRadius(1)).toBe(5);
  });
  it('maps mid pressure linearly', () => {
    expect(pressureToRadius(0.5)).toBeCloseTo(3.5, 5);
  });
  it('caps growth at prevR + 1 along a stroke', () => {
    expect(pressureToRadius(1, 2)).toBe(3); // would be 5, capped to 2+1
  });
  it('clamps out-of-range pressure', () => {
    expect(pressureToRadius(-1)).toBe(2);
    expect(pressureToRadius(9)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/ink-pressure.test.js`
Expected: FAIL — cannot import `pressureToRadius` (module/file missing).

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/ink.js`:

```js
// Pure geometry + stroke model for the ink surface. No DOM at module scope.

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/ink-pressure.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/ink.js tests/unit/ink-pressure.test.js
git commit -m "feat(ink): pressure to radius mapping (2-5px, growth-capped)"
```

---

### Task 3: Scribble-to-erase classifier

**Files:**
- Modify: `tom-diary/js/ink.js`
- Test: `tom-diary/tests/unit/ink-eraser.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `isEraserStroke(points: {x,y}[], opts?): boolean` — true for a fast back-and-forth zigzag (enough horizontal direction reversals per unit path length).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { isEraserStroke } from '../../js/ink.js';

// A straight diagonal line — normal ink, no reversals.
const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: i * 5 }));

// A tight zigzag over a short span — scribble erase.
const zigzag = Array.from({ length: 40 }, (_, i) => ({
  x: 100 + (i % 2 === 0 ? 0 : 30),
  y: 100 + i * 2,
}));

describe('isEraserStroke', () => {
  it('rejects a straight line', () => {
    expect(isEraserStroke(line)).toBe(false);
  });
  it('accepts a tight zigzag', () => {
    expect(isEraserStroke(zigzag)).toBe(true);
  });
  it('rejects a stroke too short to judge', () => {
    expect(isEraserStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/ink-eraser.test.js`
Expected: FAIL — `isEraserStroke` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/ink.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/ink-eraser.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/ink.js tests/unit/ink-eraser.test.js
git commit -m "feat(ink): scribble-to-erase stroke classifier"
```

---

### Task 4: Stroke store, erase application, and empty detection

**Files:**
- Modify: `tom-diary/js/ink.js`
- Test: `tom-diary/tests/unit/ink-store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createStrokeStore(): { strokes, begin(pt), extend(pt), end(), erase(x,y,r), clear() }` where `strokes` is `{ points: {x,y,r}[] }[]` of finished strokes.
  - `eraseStrokes(strokes, ex, ey, radius): strokes` — removes points within `radius + 2` and splits strokes at the gaps (ported from `ink.rs` forget radius = paint radius + 2).
  - `isPageEmpty(strokes): boolean` — true when no ink points remain.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createStrokeStore, eraseStrokes, isPageEmpty } from '../../js/ink.js';

describe('eraseStrokes', () => {
  it('splits a stroke into two when erasing its middle', () => {
    const strokes = [{ points: [
      { x: 0, y: 0, r: 2 }, { x: 10, y: 0, r: 2 }, { x: 50, y: 0, r: 2 },
      { x: 90, y: 0, r: 2 }, { x: 100, y: 0, r: 2 },
    ] }];
    const out = eraseStrokes(strokes, 50, 0, 5); // radius+2 = 7 around x=50
    expect(out).toHaveLength(2);
    expect(out[0].points.every(p => p.x < 50)).toBe(true);
    expect(out[1].points.every(p => p.x > 50)).toBe(true);
  });
  it('drops a stroke entirely when all points are erased', () => {
    const strokes = [{ points: [{ x: 0, y: 0, r: 2 }, { x: 1, y: 0, r: 2 }] }];
    expect(eraseStrokes(strokes, 0.5, 0, 5)).toHaveLength(0);
  });
});

describe('isPageEmpty', () => {
  it('is true for no strokes', () => {
    expect(isPageEmpty([])).toBe(true);
  });
  it('is false when ink points remain', () => {
    expect(isPageEmpty([{ points: [{ x: 1, y: 1, r: 2 }] }])).toBe(false);
  });
});

describe('createStrokeStore', () => {
  it('accumulates a finished stroke', () => {
    const s = createStrokeStore();
    s.begin({ x: 0, y: 0, r: 2 });
    s.extend({ x: 5, y: 0, r: 2 });
    s.end();
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].points).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/ink-store.test.js`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/ink.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/ink-store.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/ink.js tests/unit/ink-store.test.js
git commit -m "feat(ink): stroke store, erase split, empty-page detection"
```

---

### Task 5: Idle-commit timer

**Files:**
- Create: `tom-diary/js/commit.js`
- Test: `tom-diary/tests/unit/commit-timer.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createIdleTimer(delayMs, onFire): { activity(), penDown(), penUp(), cancel() }`. `activity()` resets the countdown on any pen sample; the timer only counts while the pen is up; `onFire` runs `delayMs` after the last activity with the pen up.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleTimer } from '../../js/commit.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createIdleTimer', () => {
  it('fires 2800ms after pen-up with no further activity', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penDown(); t.activity(); t.penUp();
    vi.advanceTimersByTime(2799);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
  it('does not fire while the pen is down', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penDown(); t.activity();
    vi.advanceTimersByTime(5000);
    expect(onFire).not.toHaveBeenCalled();
  });
  it('resets the countdown when a new stroke starts', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penUp();
    vi.advanceTimersByTime(2000);
    t.penDown(); t.penUp(); // new activity resets
    vi.advanceTimersByTime(2000);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/commit-timer.test.js`
Expected: FAIL — `commit.js` / `createIdleTimer` missing.

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/commit.js`:

```js
// Idle-commit timing + commit geometry. Pure logic; renderCommitPng touches canvas.

/**
 * Ported from riddle main.rs: IDLE_COMMIT window measured from the last pen
 * sample, only counting while the pen is up.
 */
export function createIdleTimer(delayMs, onFire) {
  let handle = null;
  let down = false;
  const clear = () => { if (handle) { clearTimeout(handle); handle = null; } };
  const schedule = () => { clear(); if (!down) handle = setTimeout(onFire, delayMs); };
  return {
    activity() { schedule(); },
    penDown() { down = true; clear(); },
    penUp() { down = false; schedule(); },
    cancel() { clear(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/commit-timer.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/commit.js tests/unit/commit-timer.test.js
git commit -m "feat(commit): idle-commit timer (2800ms, pen-up only)"
```

---

### Task 6: Commit bounding box + downscale math

**Files:**
- Modify: `tom-diary/js/commit.js`
- Test: `tom-diary/tests/unit/commit-box.test.js`

**Interfaces:**
- Consumes: stroke shape `{ points: {x,y,r}[] }[]` from `ink.js`.
- Produces: `computeCommitBox(strokes, canvasW, canvasH, pad = 20): { x0, y0, w, h, factor, outW, outH } | null`. Crops to the ink bbox (including per-point radius), pads by 20 px clamped to canvas bounds, and computes the integer downscale `factor = max(ceil(max(w,h)/800), 2)` plus output dimensions. Returns `null` for an empty page.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { computeCommitBox } from '../../js/commit.js';

const strokes = [{ points: [
  { x: 100, y: 100, r: 2 },
  { x: 300, y: 260, r: 4 },
] }];

describe('computeCommitBox', () => {
  it('crops to bbox + 20px pad, clamped to canvas', () => {
    const box = computeCommitBox(strokes, 2000, 2000);
    // bbox with radius: x[98..304], y[98..264]; +20 pad
    expect(box.x0).toBe(78);
    expect(box.y0).toBe(78);
    expect(box.w).toBe((304 + 20) - 78);
    expect(box.h).toBe((264 + 20) - 78);
  });
  it('clamps the pad at the canvas edge', () => {
    const box = computeCommitBox([{ points: [{ x: 5, y: 5, r: 2 }] }], 1000, 1000);
    expect(box.x0).toBe(0);
    expect(box.y0).toBe(0);
  });
  it('always downscales at least 2x', () => {
    const box = computeCommitBox([{ points: [{ x: 10, y: 10, r: 2 }, { x: 40, y: 40, r: 2 }] }], 1000, 1000);
    expect(box.factor).toBe(2); // small page still halved
  });
  it('scales large pages so the long side is <= 800', () => {
    const box = computeCommitBox([{ points: [{ x: 0, y: 0, r: 2 }, { x: 3200, y: 100, r: 2 }] }], 4000, 4000);
    expect(box.factor).toBe(Math.ceil((3200 + 2 + 20 + 20) / 800));
    expect(Math.max(box.outW, box.outH)).toBeLessThanOrEqual(800);
  });
  it('returns null for an empty page', () => {
    expect(computeCommitBox([], 1000, 1000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/commit-box.test.js`
Expected: FAIL — `computeCommitBox` missing.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/commit.js`:

```js
export function computeCommitBox(strokes, canvasW, canvasH, pad = 20) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      const r = p.r ?? 2;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    }
  }
  if (!Number.isFinite(x0)) return null;
  x0 = Math.max(0, Math.floor(x0) - pad);
  y0 = Math.max(0, Math.floor(y0) - pad);
  x1 = Math.min(canvasW, Math.ceil(x1) + pad);
  y1 = Math.min(canvasH, Math.ceil(y1) + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const factor = Math.max(Math.ceil(Math.max(w, h) / 800), 2);
  return { x0, y0, w, h, factor, outW: Math.round(w / factor), outH: Math.round(h / factor) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/commit-box.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/commit.js tests/unit/commit-box.test.js
git commit -m "feat(commit): crop/pad/min-2x downscale box math"
```

---

### Task 7: Commit PNG render (browser)

`renderCommitPng` needs a real 2D canvas, so it is verified in Playwright, not jsdom.

**Files:**
- Modify: `tom-diary/js/commit.js`
- Create: `tom-diary/tests/browser/commit-render.spec.js`
- Create: `tom-diary/tests/browser/fixtures/commit-harness.html`

**Interfaces:**
- Consumes: `computeCommitBox` (same module).
- Produces: `renderCommitPng(strokes, box): string` — a `data:image/png;base64,…` URI of the cropped, downscaled page drawn as **black ink on white**.

- [ ] **Step 1: Write the failing test (browser harness + spec)**

Create `tom-diary/tests/browser/fixtures/commit-harness.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<body>
<script type="module">
  import { computeCommitBox, renderCommitPng } from '/js/commit.js';
  window.runCommit = (strokes, w, h) => {
    const box = computeCommitBox(strokes, w, h);
    return { box, uri: renderCommitPng(strokes, box) };
  };
  document.body.dataset.ready = '1';
</script>
</body>
```

Create `tom-diary/tests/browser/commit-render.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('renderCommitPng returns a PNG data URI with black ink on white', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/commit-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const result = await page.evaluate(() => {
    const strokes = [{ points: [
      { x: 100, y: 100, r: 3 }, { x: 200, y: 100, r: 3 }, { x: 300, y: 100, r: 3 },
    ] }];
    const { box, uri } = window.runCommit(strokes, 1000, 1000);
    return { uri, outW: box.outW, outH: box.outH };
  });
  expect(result.uri.startsWith('data:image/png;base64,')).toBe(true);
  expect(result.outW).toBeGreaterThan(0);
  expect(result.outH).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx playwright test tests/browser/commit-render.spec.js`
Expected: FAIL — `renderCommitPng` is not a function.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/commit.js`:

```js
/**
 * Draw the cropped/downscaled page as black ink on white and return a PNG
 * data URI. Browser-only (needs a real 2D context).
 */
export function renderCommitPng(strokes, box) {
  const canvas = document.createElement('canvas');
  canvas.width = box.outW;
  canvas.height = box.outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  const f = box.factor;
  for (const s of strokes) {
    for (const p of s.points) {
      const x = (p.x - box.x0) / f;
      const y = (p.y - box.y0) / f;
      const r = Math.max(0.5, (p.r ?? 2) / f);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas.toDataURL('image/png');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx playwright test tests/browser/commit-render.spec.js`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/commit.js tests/browser/commit-render.spec.js tests/browser/fixtures/commit-harness.html
git commit -m "feat(commit): render committed page to a black-on-white PNG"
```

---

### Task 8: "!" help-gesture detection

**Files:**
- Create: `tom-diary/js/help.js`
- Test: `tom-diary/tests/unit/help-gesture.test.js`

**Interfaces:**
- Consumes: stroke shape `{ points: {x,y}[] }[]`.
- Produces: `looksLikeExclamation(strokes, canvasHeight, opts?): boolean` — true for 1–2 strokes whose main (longest) stroke is a near-vertical, roughly-straight bar at least 20% of `canvasHeight` tall, with an optional small low dot near its x-center.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { looksLikeExclamation } from '../../js/help.js';

const H = 1000; // canvas height
// Tall vertical bar: 25% of canvas height, straight.
const bar = { points: Array.from({ length: 20 }, (_, i) => ({ x: 500, y: 200 + i * (250 / 19) })) };
// Small dot below the bar.
const dot = { points: [{ x: 500, y: 480 }, { x: 503, y: 483 }, { x: 501, y: 486 }] };

describe('looksLikeExclamation', () => {
  it('accepts a tall vertical bar plus a low dot', () => {
    expect(looksLikeExclamation([bar, dot], H)).toBe(true);
  });
  it('accepts a dotless tall bar', () => {
    expect(looksLikeExclamation([bar], H)).toBe(true);
  });
  it('rejects a bar shorter than 20% of canvas height', () => {
    const short = { points: Array.from({ length: 20 }, (_, i) => ({ x: 500, y: 200 + i * (150 / 19) })) };
    expect(looksLikeExclamation([short], H)).toBe(false);
  });
  it('rejects a wide, non-vertical stroke (fails the aspect gate)', () => {
    // Tall enough (h=260 >= 20% of H) but too wide (w=400 > 0.35*h), so it is
    // rejected by the near-vertical aspect gate, not the height gate.
    const wide = { points: Array.from({ length: 20 }, (_, i) => ({ x: 200 + i * (400 / 19), y: 200 + i * (260 / 19) })) };
    expect(looksLikeExclamation([wide], H)).toBe(false);
  });
  it('rejects an asymmetric hooked bar (fails the straightness gate)', () => {
    // 15 points straight at x=500, then a 5-point hook out to x=565: width 65
    // passes the aspect gate (65 <= 0.35*250), but the max deviation from mean-x
    // (~55) exceeds 0.20*250=50, so only the straightness gate can reject it.
    const hooked = { points: [
      ...Array.from({ length: 15 }, (_, i) => ({ x: 500, y: 200 + i * (250 / 19) })),
      ...Array.from({ length: 5 }, (_, i) => ({ x: 500 + (i + 1) * 13, y: 200 + (15 + i) * (250 / 19) })),
    ] };
    expect(looksLikeExclamation([hooked], H)).toBe(false);
  });
  it('rejects 3+ strokes', () => {
    expect(looksLikeExclamation([bar, dot, dot], H)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/help-gesture.test.js`
Expected: FAIL — `help.js` / `looksLikeExclamation` missing.

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/help.js`:

```js
// Help gesture ("!") detection + guide panel. Pure detection; show/dismiss touch DOM.

function bounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * A large "!": near-vertical, roughly straight main stroke >= 20% of canvas
 * height, plus an optional small low dot. tom-diary original.
 */
export function looksLikeExclamation(strokes, canvasHeight, {
  minHeightFrac = 0.20,
  maxAspect = 0.35,       // main stroke width / height
  maxStraightDev = 0.20,  // horizontal wander / height
  maxDotFrac = 0.25,      // dot size / main height
  dotXTolFrac = 0.04,     // dot x-center slack, as a fraction of canvas height (canvas-relative, never abs px)
} = {}) {
  if (strokes.length < 1 || strokes.length > 2) return false;
  const main = strokes.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  if (main.points.length < 8) return false;
  const m = bounds(main.points);
  if (m.h < minHeightFrac * canvasHeight) return false;   // tall enough
  if (m.w > maxAspect * m.h) return false;                // narrow / near-vertical
  const mx = main.points.reduce((a, p) => a + p.x, 0) / main.points.length;
  const dev = Math.max(...main.points.map((p) => Math.abs(p.x - mx)));
  if (dev > maxStraightDev * m.h) return false;           // roughly straight
  if (strokes.length === 2) {
    const dot = strokes.find((s) => s !== main);
    const d = bounds(dot.points);
    if (Math.max(d.w, d.h) > maxDotFrac * m.h) return false;  // small
    if (d.cy < m.y1) return false;                            // below the bar
    if (Math.abs(d.cx - mx) > 0.5 * m.w + dotXTolFrac * canvasHeight) return false; // roughly under center (canvas-relative)
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/help-gesture.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/help.js tests/unit/help-gesture.test.js
git commit -m "feat(help): large-! gesture detection (canvas-relative)"
```

---

### Task 9: Help panel text + show/dismiss (browser)

**Files:**
- Modify: `tom-diary/js/help.js`
- Test: `tom-diary/tests/browser/help-panel.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `HELP_LINES: string[]` — the adapted (web) guide text.
  - `showHelpPanel(root, { onDismiss, autoDismissMs = 45000 }): () => void` — renders the panel into `root`, auto-dismisses after 45s or on pointerdown, calls `onDismiss` once, returns a manual-dismiss function.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/browser/help-panel.spec.js`:

```js
import { test, expect } from '@playwright/test';

const HARNESS = `data:text/html,<body><script type="module">
  import { showHelpPanel, HELP_LINES } from '${'/js/help.js'}';
  window.__lines = HELP_LINES;
  window.__dismissed = 0;
  showHelpPanel(document.body, { onDismiss: () => { window.__dismissed++; } });
  document.body.dataset.ready = '1';
</script></body>`;

test('help panel shows adapted text and dismisses on pointer', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/help-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('.help-panel')).toBeVisible();
  await expect(page.locator('.help-panel')).toContainText('The Diary');
  await expect(page.locator('.help-panel')).toContainText('rest your quill');
  // web-adapted: no reMarkable-only lines
  await expect(page.locator('.help-panel')).not.toContainText('five fingers');
  await expect(page.locator('.help-panel')).not.toContainText('AppLoad');
  await page.mouse.click(10, 10);
  await expect(page.locator('.help-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dismissed)).toBe(1);
});
```

Create `tom-diary/tests/browser/fixtures/help-harness.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<body>
<script type="module">
  import { showHelpPanel, HELP_LINES } from '/js/help.js';
  window.__lines = HELP_LINES;
  window.__dismissed = 0;
  showHelpPanel(document.body, { onDismiss: () => { window.__dismissed++; } });
  document.body.dataset.ready = '1';
</script>
</body>
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx playwright test tests/browser/help-panel.spec.js`
Expected: FAIL — `showHelpPanel` / `HELP_LINES` missing.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/help.js`:

```js
// Web-adapted guide text (riddle's windowed variant, minus reMarkable-only lines).
export const HELP_LINES = [
  'The Diary',
  '',
  'Write, then rest your quill:',
  'the diary drinks your ink and Tom replies.',
  '',
  'The diary remembers. Ask it:',
  '"show me what I wrote about..."',
  'and the page will rise again.',
  '',
  'Scribble back and forth to erase.',
  '',
  'A large ! summons this guide.',
  '',
  'Touch pen to page to close.',
];

export function showHelpPanel(root, { onDismiss, autoDismissMs = 45000 } = {}) {
  const panel = document.createElement('div');
  panel.className = 'help-panel';
  for (const line of HELP_LINES) {
    const el = document.createElement('div');
    el.className = 'help-line';
    el.textContent = line;
    panel.appendChild(el);
  }
  root.appendChild(panel);

  let done = false;
  let timer = null;
  const dismiss = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    panel.removeEventListener('pointerdown', dismiss);
    panel.remove();
    if (onDismiss) onDismiss();
  };
  panel.addEventListener('pointerdown', dismiss);
  timer = setTimeout(dismiss, autoDismissMs);
  return dismiss;
}

export function dismissHelpPanel(root) {
  const panel = root.querySelector('.help-panel');
  if (panel) panel.dispatchEvent(new PointerEvent('pointerdown'));
}
```

- [ ] **Step 4: Add panel styling**

Append to `tom-diary/css/paper.css`:

```css
.help-panel {
  position: fixed; inset: 0; z-index: 10;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.2em; padding: 2rem; text-align: center;
  background: rgba(244, 236, 216, 0.96); color: #33302a;
  font-family: Georgia, 'Times New Roman', serif;
}
.help-panel .help-line { font-size: clamp(1rem, 3.5vh, 2rem); line-height: 1.4; }
.help-panel .help-line:first-child { font-size: clamp(1.6rem, 6vh, 3.2rem); margin-bottom: 0.5em; }
.help-panel .help-line:last-child { margin-top: 0.6em; opacity: 0.75; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tom-diary && npx playwright test tests/browser/help-panel.spec.js`
Expected: PASS — 1 test.

- [ ] **Step 6: Commit**

```bash
cd tom-diary && git add js/help.js css/paper.css tests/browser/help-panel.spec.js tests/browser/fixtures/help-harness.html
git commit -m "feat(help): guide panel with web-adapted text + dismiss"
```

---

### Task 10: Ink surface wiring + end-to-end write/erase/commit/help (browser)

Ties the pure modules together behind Pointer Events. This is the plan's integration deliverable.

**Files:**
- Modify: `tom-diary/js/ink.js` (add `initInk` wiring)
- Modify: `tom-diary/js/app-boot.js` (wire the surface for the smoke test)
- Create: `tom-diary/tests/browser/ink-surface.spec.js`

**Interfaces:**
- Consumes: `pressureToRadius`, `isEraserStroke`, `createStrokeStore` (ink.js); `createIdleTimer`, `computeCommitBox`, `renderCommitPng` (commit.js); `looksLikeExclamation`, `showHelpPanel` (help.js).
- Produces: `initInk(canvas, { onCommit, onHelp }): { store }` — captures Pointer Events, renders ink live, classifies eraser strokes, runs the idle timer, and on fire routes to help / cancel-if-empty / `onCommit(pngDataUri, strokesSnapshot)`.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/browser/ink-surface.spec.js`:

```js
import { test, expect } from '@playwright/test';

async function stroke(page, pts, { pointerType = 'pen', pressure = 0.5 } = {}) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType, pressure, isPrimary: true });
  for (const p of pts.slice(1)) {
    await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType, pressure, isPrimary: true });
  }
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType, pressure, isPrimary: true });
}

test('writing then resting fires a commit with a PNG', async ({ page }) => {
  await page.goto('/?idle=300'); // short idle for the test
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await stroke(page, [{ x: 200, y: 200 }, { x: 260, y: 210 }, { x: 320, y: 205 }]);
  await page.waitForFunction(() => window.__lastCommit != null, null, { timeout: 3000 });
  const uri = await page.evaluate(() => window.__lastCommit);
  expect(uri.startsWith('data:image/png;base64,')).toBe(true);
});

test('a large "!" opens the help panel instead of committing', async ({ page }) => {
  await page.goto('/?idle=300');
  const h = await page.evaluate(() => window.innerHeight);
  const barTop = h * 0.2, barBottom = h * 0.55;
  const bar = Array.from({ length: 20 }, (_, i) => ({ x: 400, y: barTop + (i * (barBottom - barTop)) / 19 }));
  await stroke(page, bar);
  const dot = [{ x: 400, y: barBottom + 40 }, { x: 402, y: barBottom + 43 }, { x: 400, y: barBottom + 46 }];
  await stroke(page, dot);
  await expect(page.locator('.help-panel')).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => window.__lastCommit)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx playwright test tests/browser/ink-surface.spec.js`
Expected: FAIL — `initInk` missing / no commit recorded.

- [ ] **Step 3: Implement `initInk` in `js/ink.js`**

Append to `tom-diary/js/ink.js`:

```js
import { createIdleTimer, computeCommitBox, renderCommitPng } from './commit.js';
import { looksLikeExclamation } from './help.js';

const PAPER = '#f4ecd8';
const INK = '#33302a';
const PRESSURE_GATE = 0.01; // ~ (>40 of 4096) from riddle main.rs:327

export function initInk(canvas, { onCommit, onHelp, idleMs = 2800 } = {}) {
  const ctx = canvas.getContext('2d');
  const store = createStrokeStore();
  let penDown = false;
  let prevR = null;
  let livePts = [];

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

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' && e.pressure < PRESSURE_GATE) return;
    penDown = true;
    prevR = null;
    livePts = [];
    timer.penDown();
    addPoint(e, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!penDown) return;
    if (e.pointerType === 'pen' && e.pressure < PRESSURE_GATE) return;
    addPoint(e, false);
    timer.activity();
  });
  canvas.addEventListener('pointerup', () => {
    if (!penDown) return;
    penDown = false;
    if (isEraserStroke(livePts)) {
      // discard as ink; erase along the path instead
      for (const p of livePts) store.erase(p.x, p.y, 22);
      repaint();
    } else {
      store.end();
    }
    livePts = [];
    timer.penUp();
  });

  function addPoint(e, isStart) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    const r = pressureToRadius(pressure, prevR);
    prevR = r;
    const pt = { x, y, r };
    livePts.push(pt);
    if (isStart) store.begin(pt); else store.extend(pt);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  repaint();
  return { store };
}
```

- [ ] **Step 4: Wire the surface in `js/app-boot.js` for the smoke test**

Replace `tom-diary/js/app-boot.js` with:

```js
import { initInk } from './ink.js';
import { showHelpPanel } from './help.js';

const canvas = document.getElementById('page');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();

const idle = Number(new URLSearchParams(location.search).get('idle')) || 2800;
initInk(canvas, {
  idleMs: idle,
  onCommit: (uri) => { window.__lastCommit = uri; },
  onHelp: () => showHelpPanel(document.body, { onDismiss: () => {} }),
});
document.body.dataset.ready = 'true';
```

- [ ] **Step 5: Run the browser tests to verify they pass**

Run: `cd tom-diary && npx playwright test tests/browser/ink-surface.spec.js`
Expected: PASS — 2 tests.

- [ ] **Step 6: Run the full suite**

Run: `cd tom-diary && npm test && npm run test:browser`
Expected: all Vitest unit specs pass; all Playwright specs pass.

- [ ] **Step 7: Commit**

```bash
cd tom-diary && git add -A
git commit -m "feat(ink): wire Pointer Events -> write/erase/idle-commit/help"
```

---

## Self-Review

**1. Spec coverage (Plan 1 scope only):**
- Ink capture, Pointer Events, pen/finger, `touch-action: none`, pressure→radius, live render → Tasks 2, 10 + `paper.css`.
- Pressure gate + growth smoothing → Tasks 2, 10.
- Scribble-to-erase → Tasks 3, 10.
- Idle-commit timer semantics → Task 5.
- Commit crop/pad/min-2× grayscale black-on-white PNG → Tasks 6, 7.
- Fully-erased cancellation → Tasks 4 (`isPageEmpty`) + 6 (null box) + 10.
- "!" gesture + guide panel + auto-dismiss + web-adapted text → Tasks 8, 9, 10.
- Warm paper theme → `paper.css`.
- Deferred to later plans (intentionally, noted in Plan sequence): oracle/streaming, handwriting synthesis, memory/catalog/conjuring, the full 9-state machine, settings, PWA/manifest/service worker. No Plan-1 requirement is left unassigned.

**2. Placeholder scan:** No TBDs, no "add error handling", no "similar to Task N" — every code step contains complete code. ✅

**3. Type consistency:** Stroke shape `{ points: {x,y,r}[] }[]` is used identically across `ink.js`, `commit.js`, and `initInk`. `computeCommitBox` returns `{x0,y0,w,h,factor,outW,outH}` and `renderCommitPng` consumes exactly those fields. `looksLikeExclamation(strokes, canvasHeight)` signature matches its call in `initInk`. `createIdleTimer(delayMs, onFire)` matches Task 10 usage. `showHelpPanel(root, {onDismiss})` matches Task 10 usage. ✅

> One deliberate simplification vs. the spec's prose: "fully erased" is detected at the **vector** level (no ink points remain / `computeCommitBox` returns `null`) rather than by the spec's pixel luma<200 scan. This is equivalent for our canvas (we only ever draw the strokes we hold) and avoids a readback; noted here so the reviewer sees it is intentional.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-tom-diary-01-ink-surface.md`. This is plan 1 of 4; plans 2–4 will be authored after this one is executed (their interfaces depend on the exports built here).
