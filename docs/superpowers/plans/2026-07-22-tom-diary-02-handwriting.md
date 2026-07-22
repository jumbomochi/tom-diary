# tom-diary Plan 2 — Handwriting Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a string of reply text into Tom's animated handwriting on the page — rasterize each glyph in Dancing Script, thin it to a 1px medial-axis skeleton (Zhang-Suen), trace that into ordered centerline polylines (cached per char+size), lay the lines out per `plan_reply`, and reveal them stroke-by-stroke with a round brush — plus the dither-dissolve used to "drink" and fade ink. No LLM and no state machine yet; this plan delivers the drawing engine that Plan 4 wires in.

**Architecture:** Same split as Plan 1 — every module exports **pure functions** (the thinning/tracing grid algorithms, layout math, wobble LCG, reveal stepping, dissolve pixel test) that run under Vitest+jsdom with no canvas, plus thin browser-only wiring (`opentype.js` glyph rasterization, canvas drawing, animation timers) smoke-tested with Playwright against the real font. The one non-trivial algorithm — Zhang-Suen thin + trace — operates on a plain `Uint8Array` bitmap passed in, so it is fully unit-testable without a browser, and rasterization is the only step that needs a real canvas.

**Tech Stack:** ES modules, HTML `<canvas>`, `opentype.js` 2.0.0 (glyph outlines + metrics/kerning, vendored as ESM), Vitest + jsdom (unit), `@playwright/test` (browser smoke). Dev-only tooling; the app ships as static files plus the vendored font and `opentype.mjs`.

## Global Constraints

These apply to every task. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tom-diary-web-port-design.md`) and the audited `riddle` source; they must not drift.

- **No build step for the shipped app.** `js/*.js` are ES modules loaded directly by the browser. `vendor/opentype.mjs` is imported with a relative path. Vitest/Playwright and `opentype.js` are dev dependencies only; nothing compiles the app.
- **Pure logic is separated from DOM/canvas wiring** in every module: exported pure functions must be importable under jsdom without creating a canvas or touching `window`. Rasterization, canvas drawing, and animation timers live only inside factory/`init`-style functions exercised in the browser.
- **Ported constants (do not change):** `REPLY_PX = 96` (px height of the em box, i.e. `opentype` `fontSize`, not a CSS font-size); line height `= floor(REPLY_PX * 1.25) = 120`; `MARGIN_X = 120`; wrap width `= screenW - 2*MARGIN_X`; first-chunk top `y = max(floor((screenH - totalH)/3), 60)`; reveal `= 26` centerline points per `14` ms tick, brush **radius 2**; linger `= min(4000 + totalPoints*2, 20000)` ms where `totalPoints` = total centerline point count; Drinking dissolve `= 14` stages × `70` ms; FadingReply dissolve `= 10` stages × `80` ms.
- **Wobble is deterministic, not random.** A single u32 LCG seeded with `0x1234`, advanced **once per line**, applied as a whole-line integer y-shift: `seed = (seed*1664525 + 1013904223) mod 2^32; wobble = ((seed>>>16) % 7) - 3`. Use `Math.imul` and `>>> 0` so the arithmetic matches Rust's wrapping u32. Never `Math.random()`, never per-glyph.
- **Reply ink is solid black** (`#000000`), uniform radius-2 round stamps, hard-edged — no anti-alias ramp, no opacity, no width taper. The warm gray `#33302a` is the *user's* live ink (Plan 1); the faded gray `#787878` is *conjured memory* ink (Plan 4). The reveal animator must be color/radius/pacing-parameterized so Plan 4 can reuse it for the faster faded conjure replay (48 pts / 10 ms, `#787878`).
- **Warm paper theme:** page background is cream `#f4ecd8`. The dissolve clears ink back to **cream**, and treats a pixel as ink when its luma `< 200` (adapted from `riddle`'s `luma < 250` vs white, because the cream background itself sits below 250 — see Task 9).
- **Coordinates are CSS pixels** in the page canvas's own space. The context is already DPR-scaled by `app-boot.js` (Plan 1), so all drawing math is in CSS px, exactly like `ink.js`.

---

## Consumes from Plan 1 (already on `main`)

Plan 2 draws onto the same page canvas Plan 1 set up and reuses its data shapes. Real, current signatures:

- A **stroke** is `{ points: [{ x, y, r }, ...] }` (radius per point). Reply/skeleton polylines in this plan are the lighter `Array<[x, y]>` (integer pixel coords, no radius — the reveal brush uses a uniform radius).
- `js/ink.js` — `createStrokeStore()`, `initInk(canvas, { onCommit, onHelp, idleMs })`; colors `PAPER = '#f4ecd8'`, `INK = '#33302a'` are defined there (module-private). Plan 2 re-declares the cream value as its own paper constant rather than importing a private.
- `js/commit.js` — `computeCommitBox`, `renderCommitPng` (not used here; listed for context).
- `js/app-boot.js` — creates `<canvas id="page">`, sets `canvas.width/height = client*dpr` and `ctx.setTransform(dpr,0,0,dpr,0,0)`. Plan 2's drawing assumes this CSS-px context. Wiring the writer into the live app is **Plan 4**; this plan proves it via test fixtures.
- Test conventions: unit specs in `tests/unit/*.test.js` (Vitest, jsdom), browser specs in `tests/browser/*.spec.js` with static HTML fixtures in `tests/browser/fixtures/` served from repo root at `http://localhost:8080`. Browser fixtures use `document.body.dataset.ready = 'true'` as the "module loaded" signal and stash results on `window.__*`.

---

## Plan sequence (context for the reviewer)

This is plan **2 of 4**:

1. **Foundation & ink surface** — DONE (merged as `380c645`).
2. **Handwriting synthesis (this plan)** — `skeleton.js`, `glyphs.js`, `layout.js`, `reveal.js`, `dissolve.js`, and the `handwriting.js` facade.
3. **Oracle & memory** — `oracle.js`, `memory.js`.
4. **App integration, settings & PWA** — `app.js` 9-state machine (consumes this plan's `createReplyWriter` and `runDissolve`), `settings.js`, `manifest.webmanifest`, `sw.js`, deploy.

**Deviation from `riddle`, decided in the spec (§Architecture):** `riddle` rasterizes and thins a *whole line* at once, so Dancing Script's connecting strokes get traced as joined paths. This plan caches the thin/trace **per glyph (char, px)** for live-reply performance, then reassembles a line from cached glyph polylines at their kerned caret positions. Consequence: letters are traced independently, so the connected-script joins between letters are lost — an accepted trade-off. The same `traceString` pipeline can rasterize any string (a whole word or line), so the cache granularity is a one-line policy change if the disconnected look proves wrong (see Open Risks).

---

## File structure (this plan)

- `package.json` — add `opentype.js` dev dependency (source of the vendored ESM + version pin).
- `vendor/opentype.mjs` — opentype.js 2.0.0 ESM build, copied from `node_modules`, committed so the app has no runtime npm dependency.
- `fonts/DancingScript.ttf`, `fonts/OFL.txt` — the reply font + its license, copied from `riddle/fonts/`.
- `js/skeleton.js` — **pure:** `thinZhangSuen(mask, w, h)`, `traceSkeleton(mask, w, h, minPoints)`.
- `js/layout.js` — **pure:** `wrapLines(text, maxW, measure)`, `makeWobble(seed)`, `planReply(text, provider, opts)`.
- `js/glyphs.js` — **wiring:** `loadFont(url)`, `createGlyphCache(font, px)` → a layout `provider` (`measure`, `line`, `lineHeight`, `space`) backed by `opentype.js` + offscreen-canvas rasterization + `skeleton.js`.
- `js/reveal.js` — **pure:** `stepReveal(cursor, strokes, budget)`, `lingerMs(totalPoints)`; **wiring:** `stampDot`, `brushLine`, `createRevealAnimator(ctx, opts)`.
- `js/dissolve.js` — **pure:** `pxHash(x, y)`, `shouldClear(x, y, stage, stages)`; **wiring:** `runDissolve(ctx, region, opts)`; constants `DRINK_STAGES/STEP_MS`, `FADE_STAGES/STEP_MS`.
- `js/handwriting.js` — **facade:** `createReplyWriter(canvas, font, opts)` composing glyphs + layout + reveal; re-exports `runDissolve` for Plan 4.
- `demo.html` — manual visual harness (write a sample reply, dissolve it) for hand-tuning; not a test.
- `tests/unit/*.test.js`, `tests/browser/*.spec.js`, `tests/browser/fixtures/*.html`.

---

### Task 1: Assets and dependency — font + vendored opentype

Bring in the reply font and the ESM `opentype.js` build, and prove the font parses and yields metrics in a real browser.

**Files:**
- Modify: `tom-diary/package.json` (add dev dependency)
- Create: `tom-diary/fonts/DancingScript.ttf` (copied), `tom-diary/fonts/OFL.txt` (copied)
- Create: `tom-diary/vendor/opentype.mjs` (copied from node_modules)
- Create: `tom-diary/tests/browser/fixtures/font-harness.html`
- Test: `tom-diary/tests/browser/font-load.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `fonts/DancingScript.ttf` at a stable path, `vendor/opentype.mjs` importable in the browser as `import * as opentype from '../vendor/opentype.mjs'`, and `opentype.js` available to Node/Vitest via `import`.

- [ ] **Step 1: Add the dev dependency and install**

Add `"opentype.js": "^2.0.0"` to `devDependencies` in `package.json`, then:

Run: `cd tom-diary && npm install`
Expected: `node_modules/opentype.js/dist/opentype.mjs` exists.

- [ ] **Step 2: Copy the font, license, and vendored ESM into the repo**

Run:
```bash
cd tom-diary
mkdir -p fonts vendor
cp ../riddle/fonts/DancingScript.ttf fonts/DancingScript.ttf
cp ../riddle/fonts/OFL.txt fonts/OFL.txt
cp node_modules/opentype.js/dist/opentype.mjs vendor/opentype.mjs
ls -la fonts vendor
```
Expected: `fonts/DancingScript.ttf` (~133 KB), `fonts/OFL.txt`, `vendor/opentype.mjs` all present.

- [ ] **Step 3: Write the browser fixture that loads the font**

Create `tests/browser/fixtures/font-harness.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>font harness</title></head>
<body>
<script type="module">
  import * as opentype from '../../../vendor/opentype.mjs';
  (async () => {
    const buf = await fetch('../../../fonts/DancingScript.ttf').then(r => r.arrayBuffer());
    const font = opentype.parse(buf);
    const glyph = font.charToGlyph('o');
    window.__font = {
      unitsPerEm: font.unitsPerEm,
      advance: glyph.advanceWidth,
      ok: !!font.charToGlyph('A'),
    };
    document.body.dataset.ready = 'true';
  })();
</script>
</body></html>
```

- [ ] **Step 4: Write the browser test**

Create `tests/browser/font-load.spec.js`:
```js
import { test, expect } from '@playwright/test';

test('DancingScript parses via vendored opentype and exposes metrics', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/font-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const f = await page.evaluate(() => window.__font);
  expect(f.unitsPerEm).toBeGreaterThan(0);
  expect(f.advance).toBeGreaterThan(0);
  expect(f.ok).toBe(true);
});
```

- [ ] **Step 5: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- font-load`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
cd tom-diary
git add package.json package-lock.json fonts/DancingScript.ttf fonts/OFL.txt vendor/opentype.mjs tests/browser/fixtures/font-harness.html tests/browser/font-load.spec.js
git commit -m "feat(assets): vendor DancingScript font + opentype.js ESM, font-load smoke"
```

---

### Task 2: Zhang-Suen thinning

Reduce a filled bitmap to a 1px medial-axis skeleton. Pure grid algorithm — no canvas.

**Files:**
- Create: `tom-diary/js/skeleton.js`
- Test: `tom-diary/tests/unit/skeleton-thin.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `thinZhangSuen(mask, w, h) -> mask` where `mask` is a `Uint8Array` of length `w*h`, row-major, `1` = ink, `0` = empty. Mutates `mask` in place **and** returns it. Border pixels (`x` or `y` on the edge) are never removed, matching `script.rs:75-76`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/skeleton-thin.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { thinZhangSuen } from '../../js/skeleton.js';

// Build a w×h mask from an ASCII picture ('#' = ink).
function maskFrom(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '#') m[y * w + x] = 1;
  return { m, w, h };
}
const count = (m) => m.reduce((n, v) => n + v, 0);

describe('thinZhangSuen', () => {
  it('thins a thick horizontal bar toward a 1px line', () => {
    const rows = [
      '..........',
      '.########.',
      '.########.',
      '.########.',
      '..........',
    ];
    const { m, w, h } = maskFrom(rows);
    const before = count(m);
    thinZhangSuen(m, w, h);
    const after = count(m);
    expect(after).toBeLessThan(before / 2);
    // Each occupied column collapses to a single row in the interior.
    for (let x = 2; x < w - 2; x++) {
      let col = 0;
      for (let y = 0; y < h; y++) col += m[y * w + x];
      expect(col).toBeLessThanOrEqual(1);
    }
  });

  it('returns the same array instance it mutated', () => {
    const { m, w, h } = maskFrom(['###', '###', '###']);
    expect(thinZhangSuen(m, w, h)).toBe(m);
  });

  it('leaves an already-thin single pixel untouched', () => {
    const { m, w, h } = maskFrom(['.....', '..#..', '.....']);
    thinZhangSuen(m, w, h);
    expect(count(m)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npm test -- skeleton-thin`
Expected: FAIL — `thinZhangSuen` is not exported / module missing.

- [ ] **Step 3: Write the implementation**

Create `tom-diary/js/skeleton.js`:
```js
// Zhang-Suen thinning + skeleton tracing. Pure grid algorithms, ported from
// riddle script.rs. Masks are Uint8Array (0/1), row-major, length w*h.

/**
 * Reduce a filled mask to a 1px-wide skeleton (Zhang-Suen). Border pixels are
 * never removed (script.rs iterates 1..h-1, 1..w-1). Mutates and returns mask.
 */
export function thinZhangSuen(mask, w, h) {
  const at = (x, y) => mask[y * w + x];
  for (;;) {
    let changed = false;
    for (let phase = 0; phase < 2; phase++) {
      const toClear = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!at(x, y)) continue;
          // p2..p9 clockwise from North (script.rs:80-89).
          const p = [
            at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1),
          ];
          let b = 0;
          for (let i = 0; i < 8; i++) b += p[i];
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          const c1 = phase === 0 ? !(p[0] && p[2] && p[4]) : !(p[0] && p[2] && p[6]);
          const c2 = phase === 0 ? !(p[2] && p[4] && p[6]) : !(p[0] && p[4] && p[6]);
          if (c1 && c2) toClear.push(y * w + x);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) mask[i] = 0;
      }
    }
    if (!changed) break;
  }
  return mask;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tom-diary && npm test -- skeleton-thin`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/skeleton.js tests/unit/skeleton-thin.test.js
git commit -m "feat(skeleton): Zhang-Suen thinning ported from script.rs"
```

---

### Task 3: Skeleton tracing

Walk the thinned mask into ordered centerline polylines, endpoints first, left-to-right, dropping fragments under 3 points.

**Files:**
- Modify: `tom-diary/js/skeleton.js`
- Test: `tom-diary/tests/unit/skeleton-trace.test.js`

**Interfaces:**
- Consumes: `thinZhangSuen` (same module).
- Produces: `traceSkeleton(mask, w, h, minPoints = 3) -> Array<Array<[x, y]>>`. Integer `[x, y]` pairs. Order: degree-1 endpoints first (row-major scan), then any remaining pixels (loops), greedy walk to the first unvisited 8-neighbor in scan order `NW, N, NE, W, E, SW, S, SE`; paths shorter than `minPoints` dropped; strokes sorted ascending by their minimum x (`script.rs:128-195`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/skeleton-trace.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { traceSkeleton } from '../../js/skeleton.js';

function maskFrom(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '#') m[y * w + x] = 1;
  return { m, w, h };
}

describe('traceSkeleton', () => {
  it('traces a single horizontal line into one left-to-right stroke', () => {
    const { m, w, h } = maskFrom(['......', '.####.', '......']);
    const strokes = traceSkeleton(m, w, h);
    expect(strokes.length).toBe(1);
    const xs = strokes[0].map(([x]) => x);
    expect(xs).toEqual([1, 2, 3, 4]); // endpoint-first walk, left to right
  });

  it('drops fragments shorter than minPoints', () => {
    const { m, w, h } = maskFrom(['....', '.##.', '....']); // only 2 px
    expect(traceSkeleton(m, w, h, 3)).toEqual([]);
  });

  it('returns strokes sorted by minimum x', () => {
    const { m, w, h } = maskFrom([
      '..........',
      '.###..###.', // left segment (x=1..3), right segment (x=6..8)
      '..........',
    ]);
    const strokes = traceSkeleton(m, w, h);
    expect(strokes.length).toBe(2);
    const minX = strokes.map((s) => Math.min(...s.map(([x]) => x)));
    expect(minX[0]).toBeLessThan(minX[1]);
    expect(minX[0]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npm test -- skeleton-trace`
Expected: FAIL — `traceSkeleton` not exported.

- [ ] **Step 3: Write the implementation**

Append to `tom-diary/js/skeleton.js`:
```js
/**
 * Trace a 1px skeleton into ordered polylines. Endpoints first, then loops;
 * greedy 8-neighbor walk; drop paths under minPoints; sort by min x.
 * Ported from script.rs:128-195.
 */
export function traceSkeleton(mask, w, h, minPoints = 3) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Neighbor scan order matches the Rust dy(-1..1) outer, dx(-1..1) inner loop.
  const OFF = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const neighbors = (x, y) => {
    const out = [];
    for (const [dx, dy] of OFF) if (at(x + dx, y + dy)) out.push([x + dx, y + dy]);
    return out;
  };

  const visited = new Uint8Array(w * h);
  const seen = (x, y) => visited[y * w + x] === 1;
  const mark = (x, y) => { visited[y * w + x] = 1; };

  const starts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) && neighbors(x, y).length === 1) starts.push([x, y]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) starts.push([x, y]);

  const strokes = [];
  for (const [sx, sy] of starts) {
    if (seen(sx, sy)) continue;
    const path = [[sx, sy]];
    mark(sx, sy);
    let cx = sx, cy = sy;
    for (;;) {
      const next = neighbors(cx, cy).find(([nx, ny]) => !seen(nx, ny));
      if (!next) break;
      mark(next[0], next[1]);
      path.push(next);
      cx = next[0]; cy = next[1];
    }
    if (path.length >= minPoints) strokes.push(path);
  }
  strokes.sort((a, b) => Math.min(...a.map(([x]) => x)) - Math.min(...b.map(([x]) => x)));
  return strokes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tom-diary && npm test -- skeleton-trace`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/skeleton.js tests/unit/skeleton-trace.test.js
git commit -m "feat(skeleton): trace thinned mask into ordered centerline polylines"
```

---

### Task 4: Glyph cache — rasterize → thin → trace → per-glyph polylines

Wire `opentype.js` + an offscreen canvas + `skeleton.js` into a layout provider that assembles a line's centerline polylines from cached per-glyph traces. Browser-only (needs a real 2D context and `ImageData`).

**Files:**
- Create: `tom-diary/js/glyphs.js`
- Create: `tom-diary/tests/browser/fixtures/glyphs-harness.html`
- Test: `tom-diary/tests/browser/glyphs.spec.js`

**Interfaces:**
- Consumes: `thinZhangSuen`, `traceSkeleton` from `js/skeleton.js`; `opentype.parse` from `vendor/opentype.mjs`.
- Produces:
  - `loadFont(url) -> Promise<Font>` (fetch + `opentype.parse`).
  - `createGlyphCache(font, px = 96) -> provider` where `provider` is the layout provider consumed by `planReply` (Task 7):
    - `provider.measure(str) -> number` — advance-width sum with kerning, in px, no rasterization.
    - `provider.line(str) -> { width, strokes }` — `strokes` is `Array<Array<[x, y]>>` in **line-box space** (origin top-left of a box whose height is `lineHeight`, glyphs on the shared baseline), positioned at kerned caret offsets; `width` is the caret advance in px. Per-glyph traces are cached by `(char, px)`.
    - `provider.lineHeight` = `floor(px * 1.25)`.
    - `provider.space` = advance of `' '` in px.

- [ ] **Step 1: Write the implementation**

Create `tom-diary/js/glyphs.js`:
```js
// Browser wiring: opentype.js glyph outlines + offscreen-canvas rasterization
// + skeleton.js, exposed as the layout provider planReply consumes.
import { thinZhangSuen, traceSkeleton } from './skeleton.js';

export async function loadFont(url) {
  const opentype = await import('../vendor/opentype.mjs');
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  return opentype.parse(buf);
}

const INK_THRESHOLD = 128; // glyph drawn black-on-white offscreen; ink if luma < this

/** Rasterize one glyph into the shared line box and trace its skeleton. */
function traceGlyph(font, char, px, lineH, ascent) {
  const glyph = font.charToGlyph(char);
  const scale = px / font.unitsPerEm;
  const advance = glyph.advanceWidth * scale;
  const boxW = Math.max(1, Math.ceil(advance) + 4);
  const canvas = document.createElement('canvas');
  canvas.width = boxW;
  canvas.height = lineH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, boxW, lineH);
  ctx.fillStyle = '#000000';
  // opentype getPath: x/y is the pen origin; baseline at y = ascent.
  const path = glyph.getPath(2, ascent, px);
  path.fill = '#000000';
  path.draw(ctx);
  const data = ctx.getImageData(0, 0, boxW, lineH).data;
  const mask = new Uint8Array(boxW * lineH);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    if (luma < INK_THRESHOLD) mask[i] = 1;
  }
  thinZhangSuen(mask, boxW, lineH);
  const strokes = traceSkeleton(mask, boxW, lineH);
  return { advance, strokes };
}

export function createGlyphCache(font, px = 96) {
  const lineHeight = Math.floor(px * 1.25);
  const scale = px / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const cache = new Map(); // char -> { advance, strokes }
  const glyphOf = (char) => {
    let g = cache.get(char);
    if (!g) { g = traceGlyph(font, char, px, lineHeight, ascent); cache.set(char, g); }
    return g;
  };
  const kern = (a, b) =>
    font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)) * scale;

  const measure = (str) => {
    let caret = 0;
    for (let i = 0; i < str.length; i++) {
      if (i > 0) caret += kern(str[i - 1], str[i]);
      caret += glyphOf(str[i]).advance;
    }
    return caret;
  };

  const line = (str) => {
    let caret = 0;
    const strokes = [];
    for (let i = 0; i < str.length; i++) {
      if (i > 0) caret += kern(str[i - 1], str[i]);
      const g = glyphOf(str[i]);
      for (const s of g.strokes) strokes.push(s.map(([x, y]) => [x + Math.round(caret), y]));
      caret += g.advance;
    }
    return { width: caret, strokes };
  };

  return { measure, line, lineHeight, space: glyphOf(' ').advance };
}
```

- [ ] **Step 2: Write the browser fixture**

Create `tests/browser/fixtures/glyphs-harness.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>glyphs harness</title></head>
<body>
<script type="module">
  import { loadFont, createGlyphCache } from '../../../js/glyphs.js';
  (async () => {
    const font = await loadFont('../../../fonts/DancingScript.ttf');
    const cache = createGlyphCache(font, 96);
    const l = cache.line('lo');
    window.__glyphs = {
      lineHeight: cache.lineHeight,
      measure: cache.measure('lo'),
      strokeCount: l.strokes.length,
      totalPoints: l.strokes.reduce((n, s) => n + s.length, 0),
      width: l.width,
      cachedSameRef: cache.line('lo').strokes.length === l.strokes.length,
    };
    document.body.dataset.ready = 'true';
  })();
</script>
</body></html>
```

- [ ] **Step 3: Write the browser test**

Create `tests/browser/glyphs.spec.js`:
```js
import { test, expect } from '@playwright/test';

test('glyph cache rasterizes, thins, and traces real glyphs into polylines', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/glyphs-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const g = await page.evaluate(() => window.__glyphs);
  expect(g.lineHeight).toBe(120);
  expect(g.measure).toBeGreaterThan(0);
  expect(g.strokeCount).toBeGreaterThan(0);
  expect(g.totalPoints).toBeGreaterThan(20);
  expect(g.width).toBeGreaterThan(0);
  expect(g.cachedSameRef).toBe(true);
});
```

- [ ] **Step 4: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- glyphs`
Expected: PASS (1 passed). If `totalPoints` is 0, the glyph rasterized empty — check that `path.draw(ctx)` fills black on the white box and the luma threshold is right.

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/glyphs.js tests/browser/fixtures/glyphs-harness.html tests/browser/glyphs.spec.js
git commit -m "feat(glyphs): opentype rasterize->thin->trace glyph cache + layout provider"
```

---

### Task 5: Word wrap

Greedy word-wrap using an injected measure function. Pure — the measure seam keeps it testable with no font.

**Files:**
- Create: `tom-diary/js/layout.js`
- Test: `tom-diary/tests/unit/layout-wrap.test.js`

**Interfaces:**
- Consumes: a `measure(str) -> number` function (in production, `provider.measure` from Task 4).
- Produces: `wrapLines(text, maxW, measure) -> string[]`. Splits paragraphs on `\n` (each preserved as a hard break); within a paragraph, greedy: append a word while the candidate `measure <= maxW` **or** the current line is empty (so a single word wider than `maxW` overflows rather than breaking). No hyphenation. Ported from `script.rs:199-217`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/layout-wrap.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { wrapLines } from '../../js/layout.js';

// Stub measure: every char is 10px wide (spaces included).
const measure = (s) => s.length * 10;

describe('wrapLines', () => {
  it('greedily fills lines up to maxW', () => {
    const lines = wrapLines('aa bb cc dd', 59, measure); // fits "aa bb" (50), not "aa bb cc"
    expect(lines).toEqual(['aa bb', 'cc dd']);
  });

  it('overflows a single word wider than maxW rather than breaking it', () => {
    const lines = wrapLines('supercalifragilistic', 50, measure);
    expect(lines).toEqual(['supercalifragilistic']);
  });

  it('preserves explicit newlines as hard breaks', () => {
    const lines = wrapLines('aa\nbb cc', 999, measure);
    expect(lines).toEqual(['aa', 'bb cc']);
  });

  it('collapses runs of whitespace within a paragraph', () => {
    expect(wrapLines('aa    bb', 999, measure)).toEqual(['aa bb']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npm test -- layout-wrap`
Expected: FAIL — `wrapLines` not exported.

- [ ] **Step 3: Write the implementation**

Create `tom-diary/js/layout.js`:
```js
// Reply layout: word wrap, per-line wobble, and screen-space placement.
// Pure math ported from riddle script.rs (wrap) + main.rs plan_reply.

/**
 * Greedy word wrap. `measure(str)` returns pixel width. Paragraphs split on
 * '\n' become hard breaks; a word wider than maxW overflows. (script.rs:199)
 */
export function wrapLines(text, maxW, measure) {
  const lines = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = cur === '' ? word : `${cur} ${word}`;
      if (measure(cand) <= maxW || cur === '') {
        cur = cand;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur !== '') lines.push(cur);
  }
  return lines;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tom-diary && npm test -- layout-wrap`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/layout.js tests/unit/layout-wrap.test.js
git commit -m "feat(layout): greedy word wrap with injected measure"
```

---

### Task 6: Deterministic line wobble

The per-line integer y-jitter LCG. Pure; must reproduce the exact sequence.

**Files:**
- Modify: `tom-diary/js/layout.js`
- Test: `tom-diary/tests/unit/layout-wobble.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeWobble(seed = 0x1234) -> () => number`. Each call advances the u32 LCG and returns an integer in `[-3, 3]`: `seed = (seed*1664525 + 1013904223) mod 2^32; return ((seed>>>16) % 7) - 3`. Uses `Math.imul`/`>>> 0` to match Rust wrapping. From seed `0x1234` the sequence begins `[2, -3, 1, 1, 3, 2]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/layout-wobble.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { makeWobble } from '../../js/layout.js';

describe('makeWobble', () => {
  it('reproduces the exact deterministic sequence from seed 0x1234', () => {
    const next = makeWobble(0x1234);
    const seq = Array.from({ length: 6 }, () => next());
    expect(seq).toEqual([2, -3, 1, 1, 3, 2]);
  });

  it('stays within [-3, 3]', () => {
    const next = makeWobble(0x1234);
    for (let i = 0; i < 500; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('is independent per instance (same seed -> same sequence)', () => {
    const a = makeWobble(0x1234), b = makeWobble(0x1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npm test -- layout-wobble`
Expected: FAIL — `makeWobble` not exported.

- [ ] **Step 3: Write the implementation**

Append to `tom-diary/js/layout.js`:
```js
/**
 * Deterministic per-line wobble: a u32 LCG seeded 0x1234, advanced once per
 * line, mapped to an integer y-shift in [-3, 3]. (main.rs:869-873)
 */
export function makeWobble(seed = 0x1234) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return ((s >>> 16) % 7) - 3;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tom-diary && npm test -- layout-wobble`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/layout.js tests/unit/layout-wobble.test.js
git commit -m "feat(layout): deterministic per-line wobble LCG (seed 0x1234)"
```

---

### Task 7: Reply layout — planReply

Assemble wrapped lines into positioned screen-space polylines: centered horizontally, upper-third vertically, per-line wobble, with the dirty region and continuation `nextY`. Pure; tested with a stub provider.

**Files:**
- Modify: `tom-diary/js/layout.js`
- Test: `tom-diary/tests/unit/layout-plan.test.js`

**Interfaces:**
- Consumes: `wrapLines`, `makeWobble` (same module); a layout `provider` `{ measure(str), line(str) -> {width, strokes}, lineHeight }` (Task 4 in production; a stub in tests).
- Produces: `planReply(text, provider, opts) -> { strokes, region, nextY, totalPoints }` where
  - `opts` = `{ screenW, screenH, marginX = 120, yStart = null }`.
  - `strokes` = `Array<Array<[x, y]>>` in screen space (integers).
  - `region` = `{ x0, y0, x1, y1 }` bounding box of all points padded by 5px (empty-safe: `null` if no strokes).
  - `nextY` = the baseline-box top y where a streamed continuation chunk would start.
  - `totalPoints` = total centerline point count (drives linger).
  - Placement (main.rs:861-891): `maxW = screenW - 2*marginX`; `lineH = provider.lineHeight`; `totalH = lineH * lines.length`; first line top `y = yStart ?? max(floor((screenH - totalH)/3), 60)`; each line centered `x0 = round((screenW - lineWidth)/2)`; whole line shifted by `wobble` (advanced once per line, in order); `y += lineH` after each line.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/layout-plan.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { planReply } from '../../js/layout.js';

// Stub provider: 20px per char; each line is one 2-point vertical stroke at x=0..width.
const provider = {
  lineHeight: 120,
  measure: (s) => s.length * 20,
  line: (s) => ({ width: s.length * 20, strokes: [[[0, 0], [0, 10]]] }),
};

describe('planReply', () => {
  it('centers each line and stacks lines by lineHeight in the upper third', () => {
    // "aaaa bbbb" at 20px/char, maxW = 1000 - 240 = 760 -> both words fit one line (180px).
    const plan = planReply('aaaa bbbb', provider, { screenW: 1000, screenH: 1200 });
    // One wrapped line, width = 9*20 = 180 -> x0 = round((1000-180)/2) = 410.
    // totalH = 120, yTop = max(floor((1200-120)/3),60) = 360. wobble[0] = 2.
    expect(plan.strokes.length).toBe(1);
    expect(plan.strokes[0][0]).toEqual([410, 360 + 0 + 2]);
    expect(plan.strokes[0][1]).toEqual([410, 360 + 10 + 2]);
    expect(plan.nextY).toBe(360 + 120);
    expect(plan.totalPoints).toBe(2);
  });

  it('applies a fresh wobble per line, in sequence [2,-3,...]', () => {
    // Force two lines with a hard break.
    const plan = planReply('aa\nbb', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes.length).toBe(2);
    const y0 = plan.strokes[0][0][1];
    const y1 = plan.strokes[1][0][1];
    // Two lines -> totalH = 120*2 = 240, so yTop = max(floor((1200-240)/3),60) = 320.
    // line0 top 320 + wobble 2 = 322; line1 top 440 + wobble -3 = 437.
    expect(y0).toBe(322);
    expect(y1).toBe(437);
  });

  it('honors yStart for streamed continuation and reports region', () => {
    const plan = planReply('aa', provider, { screenW: 1000, screenH: 1200, yStart: 700 });
    expect(plan.strokes[0][0][1]).toBe(700 + 2); // yStart + wobble
    expect(plan.region.y0).toBeLessThan(plan.region.y1);
    expect(plan.region.x0).toBe(plan.strokes[0][0][0] - 5);
  });

  it('returns an empty-safe plan for whitespace', () => {
    const plan = planReply('   ', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes).toEqual([]);
    expect(plan.region).toBeNull();
    expect(plan.totalPoints).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npm test -- layout-plan`
Expected: FAIL — `planReply` not exported.

- [ ] **Step 3: Write the implementation**

Append to `tom-diary/js/layout.js`:
```js
/**
 * Lay reply text into screen-space polylines: word-wrapped, each line centered
 * horizontally and shifted by its wobble, stacked from the upper third down.
 * (main.rs:861-891)
 */
export function planReply(text, provider, opts) {
  const { screenW, screenH, marginX = 120, yStart = null } = opts;
  const maxW = screenW - 2 * marginX;
  const lineH = provider.lineHeight;
  const lines = wrapLines(text, maxW, provider.measure);
  const totalH = lineH * lines.length;
  let y = yStart ?? Math.max(Math.floor((screenH - totalH) / 3), 60);
  const wobble = makeWobble(0x1234);

  const strokes = [];
  let x0b = Infinity, y0b = Infinity, x1b = -Infinity, y1b = -Infinity;
  let totalPoints = 0;

  for (const lineText of lines) {
    const { width, strokes: lineStrokes } = provider.line(lineText);
    const x0 = Math.round((screenW - width) / 2);
    const wob = wobble();
    for (const s of lineStrokes) {
      const mapped = s.map(([sx, sy]) => [x0 + sx, y + sy + wob]);
      for (const [px, py] of mapped) {
        x0b = Math.min(x0b, px - 5); y0b = Math.min(y0b, py - 5);
        x1b = Math.max(x1b, px + 5); y1b = Math.max(y1b, py + 5);
      }
      totalPoints += mapped.length;
      strokes.push(mapped);
    }
    y += lineH;
  }

  const region = strokes.length ? { x0: x0b, y0: y0b, x1: x1b, y1: y1b } : null;
  return { strokes, region, nextY: y, totalPoints };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tom-diary && npm test -- layout-plan`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd tom-diary
git add js/layout.js tests/unit/layout-plan.test.js
git commit -m "feat(layout): planReply — centered, upper-third, wobbled reply placement"
```

---

### Task 8: Reveal animator — stroke-by-stroke brush

The stroke-by-stroke reveal: a pure stepping core (which points to draw this tick) plus a browser animator that draws them and the linger-duration helper.

**Files:**
- Create: `tom-diary/js/reveal.js`
- Create: `tom-diary/tests/browser/fixtures/reveal-harness.html`
- Test: `tom-diary/tests/unit/reveal-step.test.js`, `tom-diary/tests/browser/reveal.spec.js`

**Interfaces:**
- Consumes: `region` shape from `planReply` (for the browser test's plan).
- Produces:
  - **pure** `stepReveal(cursor, strokes, budget) -> { ops, cursor, done }` where `cursor = { strokeI, pointI }`; `ops` is an array of `{ x, y, from }` (`from` = `[px, py]` of the previous point in the same stroke, or `null` for a stroke's first point); advances up to `budget` points total across strokes; `done` true when all strokes consumed. (main.rs:589-609)
  - **pure** `lingerMs(totalPoints) -> number` = `Math.min(4000 + totalPoints * 2, 20000)`. (main.rs:628-630)
  - **wiring** `stampDot(ctx, x, y, r, color)`, `brushLine(ctx, x0, y0, x1, y1, r, color)` (port of `surface.brush_line`: `steps = max(|dx|,|dy|,1)`, stamp each interpolated point).
  - **wiring** `createRevealAnimator(ctx, { pointsPerTick = 26, tickMs = 14, radius = 2, color = '#000000', onDone })` → `{ setPlan(strokes), append(strokes), start(), stop() }`. Steps `pointsPerTick` points every `tickMs` via `setTimeout`, drawing each op with `stampDot`/`brushLine`; calls `onDone` once the queue is drained after `start()`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/reveal-step.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { stepReveal, lingerMs } from '../../js/reveal.js';

describe('stepReveal', () => {
  const strokes = [[[0, 0], [1, 1], [2, 2]], [[10, 10], [11, 11]]];

  it('emits a null-from op for a stroke start, then connected ops', () => {
    const { ops, cursor, done } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 2);
    expect(ops).toEqual([
      { x: 0, y: 0, from: null },
      { x: 1, y: 1, from: [0, 0] },
    ]);
    expect(cursor).toEqual({ strokeI: 0, pointI: 2 });
    expect(done).toBe(false);
  });

  it('crosses a stroke boundary within one budget and starts the next with null from', () => {
    // budget large enough to finish stroke 0 (3 pts) and start stroke 1.
    const { ops, done } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 4);
    expect(ops[2]).toEqual({ x: 2, y: 2, from: [1, 1] });
    expect(ops[3]).toEqual({ x: 10, y: 10, from: null }); // stroke 1 first point
    expect(done).toBe(false);
  });

  it('reports done once all points are consumed', () => {
    const { done, cursor } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 100);
    expect(done).toBe(true);
    expect(cursor.strokeI).toBeGreaterThanOrEqual(strokes.length);
  });
});

describe('lingerMs', () => {
  it('is 4000 + points*2, capped at 20000', () => {
    expect(lingerMs(0)).toBe(4000);
    expect(lingerMs(100)).toBe(4200);
    expect(lingerMs(100000)).toBe(20000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tom-diary && npm test -- reveal-step`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `tom-diary/js/reveal.js`:
```js
// Stroke-by-stroke handwriting reveal. Pure stepping + linger math; the
// animator and brush touch the canvas. Ported from riddle main.rs Replying.

/** Round hard-edged stamp (port of surface.stamp — filled disc, radius r). */
export function stampDot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Stamp along a line (port of surface.brush_line). */
export function brushLine(ctx, x0, y0, x1, y1, r, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    stampDot(ctx, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r, color);
  }
}

/**
 * Advance the reveal by up to `budget` points across strokes, from `cursor`.
 * Returns the draw ops (stamp when `from` is null, else a segment from the
 * previous point) and the new cursor. (main.rs:589-609)
 */
export function stepReveal(cursor, strokes, budget) {
  let { strokeI, pointI } = cursor;
  const ops = [];
  let left = budget;
  while (left > 0 && strokeI < strokes.length) {
    const stroke = strokes[strokeI];
    if (pointI >= stroke.length) { strokeI++; pointI = 0; continue; }
    const [x, y] = stroke[pointI];
    ops.push({ x, y, from: pointI > 0 ? stroke[pointI - 1] : null });
    pointI++;
    left--;
  }
  return { ops, cursor: { strokeI, pointI }, done: strokeI >= strokes.length };
}

/** Linger duration: rest the finished reply before fading. (main.rs:628-630) */
export function lingerMs(totalPoints) {
  return Math.min(4000 + totalPoints * 2, 20000);
}

/** Browser animator: reveal `pointsPerTick` points every `tickMs`. */
export function createRevealAnimator(ctx, {
  pointsPerTick = 26, tickMs = 14, radius = 2, color = '#000000', onDone,
} = {}) {
  let strokes = [];
  let cursor = { strokeI: 0, pointI: 0 };
  let handle = null;

  const draw = (op) => {
    if (op.from) brushLine(ctx, op.from[0], op.from[1], op.x, op.y, radius, color);
    else stampDot(ctx, op.x, op.y, radius, color);
  };

  const tick = () => {
    const { ops, cursor: next, done } = stepReveal(cursor, strokes, pointsPerTick);
    for (const op of ops) draw(op);
    cursor = next;
    // "done" here means the current queue is drained; append() can extend it.
    if (done) { handle = null; if (onDone) onDone(); }
    else handle = setTimeout(tick, tickMs);
  };

  return {
    setPlan(s) { strokes = s.slice(); cursor = { strokeI: 0, pointI: 0 }; },
    append(s) { strokes = strokes.concat(s); if (!handle) handle = setTimeout(tick, tickMs); },
    start() { if (!handle) handle = setTimeout(tick, tickMs); },
    stop() { if (handle) { clearTimeout(handle); handle = null; } },
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd tom-diary && npm test -- reveal-step`
Expected: PASS (4 passed).

- [ ] **Step 5: Write the browser fixture and test**

Create `tests/browser/fixtures/reveal-harness.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>reveal harness</title>
<style>html,body{margin:0}#page{display:block;width:400px;height:200px;background:#f4ecd8}</style>
</head>
<body>
<canvas id="page" width="400" height="200"></canvas>
<script type="module">
  import { createRevealAnimator } from '../../../js/reveal.js';
  const ctx = document.getElementById('page').getContext('2d');
  ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, 400, 200);
  // A diagonal stroke of 40 points.
  const stroke = Array.from({ length: 40 }, (_, i) => [10 + i * 5, 20 + i * 4]);
  const anim = createRevealAnimator(ctx, {
    pointsPerTick: 26, tickMs: 5, radius: 2, color: '#000000',
    onDone: () => {
      const px = ctx.getImageData(110, 100, 1, 1).data; // stroke midpoint (point index 20: x=10+20*5, y=20+20*4)
      window.__reveal = { done: true, r: px[0], g: px[1], b: px[2] };
      document.body.dataset.ready = 'true';
    },
  });
  anim.setPlan([stroke]);
  anim.start();
</script>
</body></html>
```

Create `tests/browser/reveal.spec.js`:
```js
import { test, expect } from '@playwright/test';

test('reveal animator draws black ink and fires onDone', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/reveal-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const r = await page.evaluate(() => window.__reveal);
  expect(r.done).toBe(true);
  // Midpoint pixel should be near-black (reply ink), not cream.
  expect(r.r).toBeLessThan(60);
  expect(r.g).toBeLessThan(60);
  expect(r.b).toBeLessThan(60);
});
```

- [ ] **Step 6: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- reveal`
Expected: PASS (1 passed).

- [ ] **Step 7: Commit**

```bash
cd tom-diary
git add js/reveal.js tests/unit/reveal-step.test.js tests/browser/fixtures/reveal-harness.html tests/browser/reveal.spec.js
git commit -m "feat(reveal): stroke-by-stroke brush reveal + linger math"
```

---

### Task 9: Dither-dissolve — drink & fade

The speckly dissolve that erases ink over N stages. Pure per-pixel test (which pixel clears at which stage) plus a browser pass that applies it over a region, adapted to clear back to cream.

**Files:**
- Create: `tom-diary/js/dissolve.js`
- Create: `tom-diary/tests/browser/fixtures/dissolve-harness.html`
- Test: `tom-diary/tests/unit/dissolve.test.js`, `tom-diary/tests/browser/dissolve.spec.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - **pure** `pxHash(x, y) -> number` (u32) — port of `ink.rs px_hash` using `Math.imul`/`>>> 0`.
  - **pure** `shouldClear(x, y, stage, stages) -> boolean` = `pxHash(x, y) % stages <= stage`. (ink.rs `dissolve_pass`)
  - **wiring** `runDissolve(ctx, region, { stages, stepMs, paper = '#f4ecd8', inkThreshold = 200, onDone })` — over `region = {x0,y0,x1,y1}` (inclusive), each stage sets every ink pixel (luma `< inkThreshold`) where `shouldClear` to `paper`, one `ImageData` read/write per stage, `stepMs` apart; `onDone` after the last stage. Returns a `cancel()`.
  - constants `DRINK_STAGES = 14`, `DRINK_STEP_MS = 70`, `FADE_STAGES = 10`, `FADE_STEP_MS = 80`.
- **Adaptation from `riddle` (documented):** `riddle` clears to white and tests `luma < 250` because its page is white; tom-diary's page is cream (`#f4ecd8`, luma ≈ 232, which is `< 250`), so the unmodified test would dissolve the background itself. We clear to cream and use `inkThreshold = 200` — the same threshold `region_all_white` uses for "is there ink here" (main.rs:757-769) — so reply ink (`#000000`) and faded conjure ink (`#787878`, luma ≈ 120) both dissolve while cream (luma ≈ 232) is left alone.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/dissolve.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { pxHash, shouldClear } from '../../js/dissolve.js';

describe('pxHash', () => {
  it('matches the ported reference values and is deterministic', () => {
    expect(pxHash(0, 0)).toBe(0);
    expect(pxHash(1, 0)).toBe(4061463559);
    expect(pxHash(10, 5)).toBe(pxHash(10, 5));
  });
});

describe('shouldClear', () => {
  it('clears an increasing subset as the stage rises, all by the last stage', () => {
    const stages = 14;
    const pts = [];
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) pts.push([x, y]);
    const cleared = (stage) => pts.filter(([x, y]) => shouldClear(x, y, stage, stages)).length;
    expect(cleared(0)).toBeGreaterThan(0);
    expect(cleared(0)).toBeLessThan(pts.length);
    expect(cleared(7)).toBeGreaterThan(cleared(0)); // monotonic growth
    expect(cleared(stages - 1)).toBe(pts.length);   // everything gone by the end
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tom-diary && npm test -- dissolve`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `tom-diary/js/dissolve.js`:
```js
// Dither-dissolve: erase ink over N speckly stages. Pure pixel test + a
// canvas pass. Ported from riddle ink.rs dissolve_pass / px_hash.

export const DRINK_STAGES = 14;
export const DRINK_STEP_MS = 70;
export const FADE_STAGES = 10;
export const FADE_STEP_MS = 80;

/** Deterministic per-pixel hash (ink.rs px_hash), wrapping u32 arithmetic. */
export function pxHash(x, y) {
  let h = (Math.imul(x >>> 0, 0x9e3779b1) ^ Math.imul(y >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Whether pixel (x,y) has dissolved by `stage` of `stages`. */
export function shouldClear(x, y, stage, stages) {
  return pxHash(x, y) % stages <= stage;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Dissolve the ink in `region` back to `paper` over `stages`. Browser-only. */
export function runDissolve(ctx, region, {
  stages, stepMs, paper = '#f4ecd8', inkThreshold = 200, onDone,
} = {}) {
  const [pr, pg, pb] = hexToRgb(paper);
  const x0 = region.x0, y0 = region.y0;
  const w = region.x1 - region.x0 + 1;
  const h = region.y1 - region.y0 + 1;
  let stage = 0;
  let handle = null;

  const pass = () => {
    const img = ctx.getImageData(x0, y0, w, h);
    const d = img.data;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const o = (yy * w + xx) * 4;
        const luma = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
        if (luma < inkThreshold && shouldClear(x0 + xx, y0 + yy, stage, stages)) {
          d[o] = pr; d[o + 1] = pg; d[o + 2] = pb; d[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, x0, y0);
    stage++;
    if (stage >= stages) { handle = null; if (onDone) onDone(); }
    else handle = setTimeout(pass, stepMs);
  };

  handle = setTimeout(pass, stepMs);
  return { cancel() { if (handle) { clearTimeout(handle); handle = null; } } };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd tom-diary && npm test -- dissolve`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the browser fixture and test**

Create `tests/browser/fixtures/dissolve-harness.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>dissolve harness</title>
<style>html,body{margin:0}#page{display:block;width:120px;height:120px}</style>
</head>
<body>
<canvas id="page" width="120" height="120"></canvas>
<script type="module">
  import { runDissolve, FADE_STAGES, FADE_STEP_MS } from '../../../js/dissolve.js';
  const ctx = document.getElementById('page').getContext('2d');
  ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, 120, 120);
  ctx.fillStyle = '#000000'; ctx.fillRect(20, 20, 80, 80); // a black ink block
  const region = { x0: 20, y0: 20, x1: 99, y1: 99 };
  const inkPixels = () => {
    const d = ctx.getImageData(20, 20, 80, 80).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (luma < 200) n++;
    }
    return n;
  };
  window.__before = inkPixels();
  runDissolve(ctx, region, {
    stages: FADE_STAGES, stepMs: FADE_STEP_MS,
    onDone: () => { window.__after = inkPixels(); document.body.dataset.ready = 'true'; },
  });
</script>
</body></html>
```

Create `tests/browser/dissolve.spec.js`:
```js
import { test, expect } from '@playwright/test';

test('runDissolve clears all ink to paper over its stages', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/dissolve-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const before = await page.evaluate(() => window.__before);
  const after = await page.evaluate(() => window.__after);
  expect(before).toBeGreaterThan(5000); // ~80x80 filled
  expect(after).toBe(0);                 // fully dissolved to cream
});
```

- [ ] **Step 6: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- dissolve`
Expected: PASS (1 passed).

- [ ] **Step 7: Commit**

```bash
cd tom-diary
git add js/dissolve.js tests/unit/dissolve.test.js tests/browser/fixtures/dissolve-harness.html tests/browser/dissolve.spec.js
git commit -m "feat(dissolve): dither-dissolve pass adapted to cream paper"
```

---

### Task 10: Handwriting facade — createReplyWriter (end-to-end)

Compose glyphs + layout + reveal into the single entry point Plan 4 will call, and prove the whole pipeline writes a real reply on a canvas. Add a manual demo page.

**Files:**
- Create: `tom-diary/js/handwriting.js`
- Create: `tom-diary/demo.html`
- Create: `tom-diary/tests/browser/fixtures/handwriting-harness.html`
- Test: `tom-diary/tests/browser/handwriting.spec.js`

**Interfaces:**
- Consumes: `loadFont`, `createGlyphCache` (`js/glyphs.js`); `planReply` (`js/layout.js`); `createRevealAnimator`, `lingerMs` (`js/reveal.js`); `runDissolve` (`js/dissolve.js`).
- Produces:
  - `createReplyWriter(canvas, font, { px = 96, marginX = 120, color = '#000000' } = {}) -> writer`.
  - `writer.write(text, { onDone } = {}) -> { region, totalPoints, lingerMs }` — plans the reply for the first chunk (upper-third), starts the reveal, returns the plan summary; `onDone` fires when the reveal drains. Uses `canvas.clientWidth/clientHeight` as `screenW/screenH`.
  - `writer.appendChunk(text) -> { region, totalPoints }` — plans a continuation from the running `nextY` and appends it to the live reveal (main.rs `append_reply`).
  - `writer.stop()`.
  - Re-export `runDissolve` and the dissolve stage constants from `js/dissolve.js` so Plan 4 imports one facade.

- [ ] **Step 1: Write the implementation**

Create `tom-diary/js/handwriting.js`:
```js
// Public facade: turn reply text into Tom's animated handwriting on a canvas.
// Composes the glyph cache, layout, and reveal. Plan 4's state machine calls
// createReplyWriter(); runDissolve is re-exported for its Drinking/Fading states.
import { createGlyphCache } from './glyphs.js';
import { planReply } from './layout.js';
import { createRevealAnimator, lingerMs } from './reveal.js';

export { loadFont } from './glyphs.js';
export { runDissolve, DRINK_STAGES, DRINK_STEP_MS, FADE_STAGES, FADE_STEP_MS } from './dissolve.js';
export { lingerMs } from './reveal.js';

export function createReplyWriter(canvas, font, { px = 96, marginX = 120, color = '#000000' } = {}) {
  const ctx = canvas.getContext('2d');
  const provider = createGlyphCache(font, px);
  let nextY = null;

  const dims = () => ({ screenW: canvas.clientWidth, screenH: canvas.clientHeight });

  return {
    write(text, { onDone } = {}) {
      const plan = planReply(text, provider, { ...dims(), marginX, yStart: null });
      nextY = plan.nextY;
      // Each reveal gets its own animator so its onDone is per-call; the
      // animator's onDone is fixed at construction (Task 8).
      if (this._active) this._active.stop();
      const a = createRevealAnimator(ctx, { color, onDone });
      a.setPlan(plan.strokes);
      a.start();
      this._active = a;
      return { region: plan.region, totalPoints: plan.totalPoints, lingerMs: lingerMs(plan.totalPoints) };
    },
    appendChunk(text) {
      const plan = planReply(text, provider, { ...dims(), marginX, yStart: nextY });
      nextY = plan.nextY;
      if (this._active) this._active.append(plan.strokes);
      return { region: plan.region, totalPoints: plan.totalPoints };
    },
    stop() { if (this._active) this._active.stop(); },
  };
}
```

> Note: `write` creates the reveal with a per-call `onDone` (the animator's `onDone` is fixed at construction). `appendChunk` extends the same running animator so streamed continuation chunks flow without restarting the reveal.

- [ ] **Step 2: Write the browser fixture**

Create `tests/browser/fixtures/handwriting-harness.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>handwriting harness</title>
<style>html,body{margin:0}#page{display:block;width:800px;height:400px;background:#f4ecd8}</style>
</head>
<body>
<canvas id="page" width="800" height="400"></canvas>
<script type="module">
  import { createReplyWriter, loadFont } from '../../../js/handwriting.js';
  (async () => {
    const canvas = document.getElementById('page');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, 800, 400);
    const font = await loadFont('../../../fonts/DancingScript.ttf');
    const writer = createReplyWriter(canvas, font, { px: 72 });
    const summary = writer.write('Yes, Harry?', {
      onDone: () => {
        // Count black-ish pixels across the canvas.
        const d = ctx.getImageData(0, 0, 800, 400).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (luma < 100) ink++;
        }
        window.__hw = { ink, totalPoints: summary.totalPoints, linger: summary.lingerMs };
        document.body.dataset.ready = 'true';
      },
    });
  })();
</script>
</body></html>
```

- [ ] **Step 3: Write the browser test**

Create `tests/browser/handwriting.spec.js`:
```js
import { test, expect } from '@playwright/test';

test('createReplyWriter writes a reply as black ink and reports its plan', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/handwriting-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 15000 });
  const hw = await page.evaluate(() => window.__hw);
  expect(hw.totalPoints).toBeGreaterThan(100);
  expect(hw.ink).toBeGreaterThan(200);          // real ink landed on the page
  expect(hw.linger).toBe(Math.min(4000 + hw.totalPoints * 2, 20000));
});
```

- [ ] **Step 4: Write the manual demo page**

Create `tom-diary/demo.html` (not a test; for hand-tuning the beats and the disconnected-script look):
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>handwriting demo</title>
<link rel="stylesheet" href="css/paper.css">
<style>#controls{position:fixed;top:8px;left:8px;z-index:5;font-family:Georgia,serif}</style>
</head>
<body>
<div id="controls">
  <input id="text" size="40" value="Do you know anything about the Chamber of Secrets?">
  <button id="write">Write</button>
  <button id="dissolve">Dissolve</button>
</div>
<canvas id="page"></canvas>
<script type="module">
  import { createReplyWriter, loadFont, runDissolve, FADE_STAGES, FADE_STEP_MS } from './js/handwriting.js';
  const canvas = document.getElementById('page');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const paint = () => { ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight); };
  paint();
  const font = await loadFont('fonts/DancingScript.ttf');
  const writer = createReplyWriter(canvas, font);
  let last = null;
  document.getElementById('write').onclick = () => { paint(); last = writer.write(document.getElementById('text').value); };
  document.getElementById('dissolve').onclick = () => {
    if (last && last.region) runDissolve(ctx, last.region, { stages: FADE_STAGES, stepMs: FADE_STEP_MS });
  };
</script>
</body></html>
```

- [ ] **Step 5: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- handwriting`
Expected: PASS (1 passed).

- [ ] **Step 6: Run the full suite**

Run: `cd tom-diary && npm test && npm run test:browser`
Expected: all unit specs pass and all browser specs pass.

- [ ] **Step 7: Commit**

```bash
cd tom-diary
git add js/handwriting.js demo.html tests/browser/fixtures/handwriting-harness.html tests/browser/handwriting.spec.js
git commit -m "feat(handwriting): createReplyWriter facade + end-to-end reveal + demo"
```

---

## Open risks / things to validate during implementation

- **Disconnected script.** Per-glyph caching (spec decision) traces each letter independently, so Dancing Script's connecting strokes between letters are lost. Validate against `demo.html` on a tablet: if it reads wrong, switch the cache to key on words/lines (the `traceString` pipeline already accepts any string) at a performance cost, or cache per-glyph but rasterize adjacent pairs. Note the trade-off; do not silently change the spec's decision.
- **Absolute sizing on smaller screens.** `REPLY_PX = 96` and `MARGIN_X = 120` are tuned for the reMarkable's ~1620px width; on a narrower iPad they may feel large. Kept as the fidelity target; expose them as `createReplyWriter` options (done) and tune by hand against `demo.html`.
- **Reply color.** The spec mandates solid black reply ink. On warm cream it may look harsh next to the user's `#33302a` gray. Kept black per spec; it is a one-option change if hand-tuning disagrees.
- **Per-glyph rasterization cost.** The spike concern from the spec: confirm the thin/trace cost per glyph is acceptable and the `(char, px)` cache keeps live streamed replies smooth. The `glyphs.spec.js` browser test exercises the real pipeline; watch its timing, and if a cold first reply stutters, consider pre-warming the cache for the ASCII range.
- **Dissolve on a backlit screen.** The dither grain was designed for e-ink. Validate that clearing to cream over 10–14 stages reads as a dissolve and not a flicker on an LCD; `stepMs` and `stages` are parameters if it needs slowing.
- **`getImageData` per stage.** `runDissolve` reads/writes the whole region each stage. For a full-screen reply region on a high-DPR canvas this is a few large `ImageData` ops; acceptable at 10–14 frames, but if it janks, restrict the region tightly (already bounded to the reply's bbox) or downsample the dither grid.

---

## Self-review notes

- **Spec coverage:** handwriting pipeline (rasterize→thin→trace, cached) = Tasks 2–4; `plan_reply` layout + wobble = Tasks 5–7; reveal pacing (26/14ms, radius 2, linger) = Task 8; dither-dissolve for Drinking/FadingReply = Task 9; facade for Plan 4 wiring = Task 10; font + `opentype.js` dependency = Task 1. Conjure's faded/faster replay reuses the parameterized `createRevealAnimator` and `runDissolve` (Plan 4). The 9-state machine, `Thinking` blot, and streamed-chunk *routing* are Plan 4; this plan supplies `appendChunk` for the streaming seam.
- **Type consistency:** stroke polylines are `Array<[x,y]>` throughout (skeleton → glyphs → layout → reveal); `region` is `{x0,y0,x1,y1}` in layout/dissolve; the layout `provider` shape (`measure`, `line`, `lineHeight`, `space`) is produced by Task 4 and consumed by Task 7 and Task 10 identically.
- **Not in scope (deferred to Plan 3/4):** `⟦show:N⟧` routing, `⁂` transcript, error-as-reply inking, memory storage/decimation, the `Thinking` pulse, and live wiring into `app.js`.
