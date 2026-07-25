# tom-diary Plan 4 — App Integration, Settings & PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the four finished engines (ink surface, handwriting, oracle, memory) into the running diary: a **pure, testable 9-state reducer** (`js/statemachine.js`) driving a thin DOM/canvas/timer driver (`js/app.js`) that owns the core loop — write → the diary drinks your ink (dissolve) → a blot thinks → Tom's reply appears as handwriting → it lingers → it dissolves → blank page — plus streamed-chunk routing (leading `⟦show:N⟧` → conjure a remembered page, replayed faded and fast), transcript capture → memory, error-as-reply inking, a `js/settings.js` panel (API key/base/model/reasoning/max-tokens/memory/tz-offset in IndexedDB, opened by a corner tap-and-hold and on first launch), and the PWA shell (`manifest.webmanifest`, `sw.js`, GitHub Pages deploy). This is the last plan; after it the app is complete.

**Architecture:** Same split as Plans 1–3. The state-transition logic is a **pure reducer** `reduce(state, event) → { state, effects }` — no DOM, no canvas, no timers, no clock reads — unit-tested under Vitest by dispatching explicit events (so every one of the 9 states and its timing transitions is testable with **zero real waits**). Timing is expressed as data: the reducer emits `{ type:'schedule', name, ms }` effects and receives `{ type:'timer', name }` events back, so tests drive time by dispatching the timer event directly. `js/app.js` is the **thin driver** that owns the canvas, the reply writer, the oracle call, the memory store, the settings, the pulsing blot, and the timers; it translates real-world callbacks (idle-commit, oracle stream events, pen taps, reveal-drain, dissolve-done, timers firing) into reducer events and executes the returned effects. The oracle's injectable `deps.fetch` (Plan 3) is threaded through so browser/unit tests feed a fake SSE stream and never hit the network. Settings persistence is a small pure serialization layer (`js/settings.js`) over the same IndexedDB the memory store uses.

**Tech Stack:** ES modules, HTML `<canvas>`, Pointer Events, IndexedDB (via `fake-indexeddb` in unit tests), Service Worker + Web App Manifest, Vitest + jsdom (unit), `@playwright/test` (browser e2e with fake-fetch fixtures). Dev-only tooling; the app ships as static files served by GitHub Pages.

## Global Constraints

These apply to every task. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tom-diary-web-port-design.md`) and the audited `riddle` source (`riddle/src/main.rs`); they must not drift.

- **No build step for the shipped app.** `js/app.js`, `js/statemachine.js`, `js/settings.js` are ES modules loaded directly by the browser. Vitest/Playwright/`fake-indexeddb` are dev dependencies only; nothing compiles the app.
- **Pure logic is separated from DOM/canvas/timer/DB wiring.** `reduce`, `initialState`, `oracleExcuse`, `triplesToPolylines`, `planConjure`, and the settings serializers must import and run under jsdom with no `window`, no canvas, no timers, and no clock reads. The driver (`initApp`), the settings panel DOM, `askOracle`, the memory/settings IndexedDB stores, and the service worker are the only wiring.
- **The reducer never reads the clock.** The page id is stamped by the driver as **unix SECONDS**: `id = Math.floor(Date.now()/1000)` — NOT `Date.now()` milliseconds. `memory.spokenDate`/`civil` treat the id as seconds; a millisecond id corrupts every catalog date. The id is passed into the reducer on the `commit` event.
- **Input gating (only Listening accepts ink):** the pen writes only in the **Listening** state. During Drinking / Thinking / Replying / Lingering / FadingReply / Help / Conjuring / MemoryShown, pen input is **swallowed** (no ink, no idle timer). A swallowed pen-down in **Lingering / Help / MemoryShown / Conjuring** is a **dismiss/interrupt** tap; in Drinking / Thinking / Replying / FadingReply it does nothing.
- **After `onCommit`, clear the stroke store immediately** (Plan 1 review flagged: an uncleared store re-fires a growing commit). This is a Plan-4 entry criterion, satisfied by the reducer's `clearInk` effect on `commit`. The *pixels* stay on the canvas so the Drinking dissolve can consume them; only the data model is cleared.
- **The oracle runs CONCURRENTLY with the Drinking dissolve** to hide latency (`main.rs:452-464` starts the oracle at commit, then animates the drink). Oracle events that arrive during Drinking are **buffered** in the reducer and processed when the drink finishes (riddle reads its channel only in Thinking).
- **`runDissolve` takes a CSS-px region** (`{x0,y0,x1,y1}`) and is DPR-aware (Plan 2). Pass it the commit/reply region in CSS px.
- **Ported timing constants (do not change):**
  - `IDLE_COMMIT = 2800` ms (`main.rs:37`).
  - **Drinking** dissolve = **14 stages × 70 ms** (`main.rs:471,480`) — `DRINK_STAGES`/`DRINK_STEP_MS` (Plan 2).
  - **Thinking** blot pulses every **600 ms** (`main.rs:535`), a black blot of **radius 9** cleared over a **28×28** box centered on screen (`main.rs:536-542`); patience timeout `ORACLE_PATIENCE = 120` s (`main.rs:40,527`) → a "timed out" excuse reply.
  - **Replying** reveal = **26 points / 14 ms**, brush **radius 2**, solid **black `#000000`** (`main.rs:591,602-604,632`).
  - **Lingering** = `min(4000 + totalPoints*2, 20000)` ms, `totalPoints` = total centerline point count (`main.rs:627-630`) — use `lingerMs` (Plan 2).
  - **FadingReply** dissolve = **10 stages × 80 ms** (`main.rs:730,739`) — `FADE_STAGES`/`FADE_STEP_MS` (Plan 2), ending on a **blank cream page**.
  - **Conjuring** replay = **48 points / 10 ms** (`main.rs:674,705`), all ink **faded gray `#787878`** (riddle `FADED`), heading date at **54 px** near the top (baseline `y≈64`, `main.rs:816-822`), reply below at **96 px** (`y = min(inkBottom+130, SCREEN_H-400)`, `main.rs:841-842`), the writer's own stored strokes replayed between them (`main.rs:831-837`); then **MemoryShown** rests up to **120 s** (`main.rs:701`).
  - **Help** panel auto-dismisses after **45 s** or on a pen tap (Plan 1 `showHelpPanel` default `autoDismissMs = 45000`).
- **Warm paper theme:** cream `#f4ecd8` background, faded memory ink `#787878`, reply ink `#000000`. The manifest `theme_color`/`background_color` are the cream `#f4ecd8`.
- **Relative asset paths** (`./…`) throughout `index.html`, `sw.js`, and the manifest, so the app works from the GitHub Pages subpath `https://jumbomochi.github.io/tom-diary/`.

---

## Consumes from Plans 1–3 (already on `main`, signatures VERIFIED against the source)

Real, current exports Plan 4 wires. Each was read from the file named.

- **`js/ink.js`** (Plan 1):
  - `createStrokeStore() → { get strokes, begin(pt), extend(pt), end(), erase(x,y,r), clear() }` — strokes are `{ points: {x,y,r}[] }[]`.
  - `initInk(canvas, { onCommit, onHelp, idleMs = 2800 }) → { store }`. It attaches its **own** Pointer Events listeners, renders live ink, classifies eraser strokes, runs the idle timer, and on fire routes to help / cancel-if-empty / `onCommit(pngDataUri, snapshot)` where `snapshot = strokes.map(s => ({ points: s.points.slice() }))`. **It has no input-gating hook today** — Task 7 extends it with a `gate` so app.js can restrict ink to Listening and receive dismissal taps.
  - `pressureToRadius`, `isEraserStroke`, `eraseStrokes`, `isPageEmpty` (pure, not needed here).
- **`js/commit.js`** (Plan 1): `computeCommitBox(strokes, canvasW, canvasH, pad=20) → { x0, y0, w, h, factor, outW, outH } | null` (CSS px); `renderCommitPng(strokes, box) → 'data:image/png;base64,…'`. The driver recomputes the dissolve region from the commit snapshot with `computeCommitBox`.
- **`js/help.js`** (Plan 1): `looksLikeExclamation(strokes, canvasHeight)`, `showHelpPanel(root, { onDismiss, autoDismissMs = 45000 }) → dismissFn`, `dismissHelpPanel(root)`, `HELP_LINES`.
- **`js/handwriting.js`** (Plan 2): `createReplyWriter(canvas, font, { px=96, marginX=120, color='#000000' }) → { write(text,{onDone}) → { region, totalPoints, lingerMs }, appendChunk(text) → { region, totalPoints }, stop() }`; `loadFont(url)`; re-exports `runDissolve(ctx, region, { stages, stepMs, paper='#f4ecd8', inkThreshold=200, onDone }) → { cancel() }`, `DRINK_STAGES=14`, `DRINK_STEP_MS=70`, `FADE_STAGES=10`, `FADE_STEP_MS=80`, `lingerMs(totalPoints)`.
- **`js/glyphs.js`** (Plan 2): `loadFont(url)`, `createGlyphCache(font, px=96) → provider` where `provider = { measure(str), line(str) → { width, strokes }, lineHeight, space }`. Conjuring builds its own **54 px** and **96 px** providers here (a font, two sizes).
- **`js/layout.js`** (Plan 2): `planReply(text, provider, { screenW, screenH, marginX=120, yStart=null }) → { strokes: Array<Array<[x,y]>>, region, nextY, totalPoints }`. `planConjure` composes this for the conjured reply.
- **`js/reveal.js`** (Plan 2): `createRevealAnimator(ctx, { pointsPerTick=26, tickMs=14, radius=2, color='#000000', onDone }) → { setPlan(strokes), append(strokes), start(), stop() }`; `lingerMs(totalPoints)`. **The conjure faded/faster replay reuses this directly** at `pointsPerTick:48, tickMs:10, color:'#787878'` — no extension to `createReplyWriter` is needed (see Decision below).
- **`js/oracle.js`** (Plan 3): `askOracle(config, turn, handlers, deps={}) → Promise<void>` (resolves when the stream ends). `config = { base, key, model, maxTokens?, reasoning?, remember? }` (base trailing-slash trimmed). `turn = { imageDataUri, history?, catalogLines?, catalogIds? }`. `handlers = { onInk(text), onShow(id), onTranscript(text), onError(text) }` — `onShow` already receives the resolved page **id** (the parser maps `catalogIds[N-1]`). `deps = { fetch? }` (defaults `globalThis.fetch`). Also `DEFAULT_BASE='https://api.openai.com/v1'`, `DEFAULT_MAX_TOKENS=2000`.
- **`js/memory.js`** (Plan 3): `openMemoryDb(factory?) → Promise<IDBDatabase>` (**Task 3 bumps this to DB v2 adding a `settings` store**); `createMemoryStore(db, { offsetHours }) → { all(), append(id,transcript,reply,inkStrokes), get(id), strokes(id), catalog(max) → {lines,ids}, recentDialogue(n), clear() }`; record shape `{ id, transcript, reply, strokes }` with `strokes` stored as decimated integer `[x,y,r]` triples; `memoryEnabled(value)` (off only for `off|0|no|false`); `spokenDate(id, offsetHours)`.
- **Test conventions:** unit specs `tests/unit/*.test.js` (Vitest, jsdom); browser specs `tests/browser/*.spec.js` with fixtures in `tests/browser/fixtures/`; browser readiness via `await expect(page.locator('body')).toHaveAttribute('data-ready','true')` (never `waitForSelector`); fixtures stash results on `window.__*`.

---

## Plan sequence (context for the reviewer)

This is plan **4 of 4** — the final plan:

1. **Foundation & ink surface** — DONE (merged).
2. **Handwriting synthesis** — DONE (merged).
3. **Oracle & memory** — DONE (merged).
4. **App integration, settings & PWA (this plan)** — `js/statemachine.js`, `js/settings.js`, `js/app.js`, the `initInk` gating extension, `manifest.webmanifest`, `sw.js`, `index.html`/`app-boot.js` wiring, and the GitHub Pages deploy doc.

### Key decisions (justified)

- **(a) `app.js` vs `statemachine.js` split — SPLIT.** The transition logic is genuinely a 9-state machine with timing beats; folding it into the DOM driver would make it untestable without real waits and canvas. `js/statemachine.js` holds the **pure reducer** (`reduce`, `initialState`) plus the pure helpers `oracleExcuse`, `triplesToPolylines`, `planConjure`. `js/app.js` is the imperative driver (`initApp`). This mirrors Plans 1–3's "pure logic vs thin wiring" rule and keeps app.js small.
- **(b) State/timing testable** via a **pure reducer with data effects and named timers.** The reducer returns `{ state, effects }`; timing transitions are `{ type:'schedule', name, ms }` effects answered by `{ type:'timer', name }` events. Unit tests dispatch events in sequence (commit → drinkDone → oracleInk → revealDrained → oracleEnd → timer:linger → fadeDone) and assert the next state + emitted effects, with **no fake timers and no waits**. The driver owns the only `setTimeout`s.
- **(c) Conjure faded replay reuses the reveal animator directly.** `createReplyWriter` is left unchanged (it hard-codes the live 26/14 black pacing, which is correct for live replies). For conjure the driver drives `createRevealAnimator(ctx, { pointsPerTick:48, tickMs:10, color:'#787878' })` over a combined plan built by the pure `planConjure(headProvider, replyProvider, entry, opts)` (heading polylines + the writer's own stored strokes via `triplesToPolylines` + the reply polylines from `planReply`). `stepReveal` destructures `[x,y]` and ignores a third element, so `[x,y,r]` triples feed it unchanged.
- **(d) Settings are stored in the same `tom-diary` IndexedDB**, in a new `settings` object store (single record under key `'config'`), created by bumping `openMemoryDb` to **DB version 2** (migration-safe: create `pages`/`settings` only if missing). This satisfies the spec's "IndexedDB, alongside memory data." The serialization (`normalizeSettings`, `settingsToConfig`) is pure and unit-tested.
- **(e) `sw.js` shell asset list** (explicit, all same-origin, relative): `./`, `./index.html`, `./manifest.webmanifest`, `./css/paper.css`, `./js/app-boot.js`, `./js/app.js`, `./js/statemachine.js`, `./js/settings.js`, `./js/ink.js`, `./js/commit.js`, `./js/help.js`, `./js/handwriting.js`, `./js/glyphs.js`, `./js/layout.js`, `./js/reveal.js`, `./js/dissolve.js`, `./js/skeleton.js`, `./js/oracle.js`, `./js/memory.js`, `./vendor/opentype.mjs`, `./fonts/DancingScript.ttf`, `./icons/icon.svg`. The oracle `fetch` is cross-origin and never intercepted.
- **(f) Spec ambiguity resolved.** The spec says conjure interrupt "returns to today's page, which is restored exactly as it was," and riddle briefly routes an interrupt through `MemoryShown{saved:None}` to swallow the closing touch before returning to Listening on pen-up (`main.rs:665-726`). tom-diary **collapses this**: a dismissal/interrupt tap in Conjuring or MemoryShown restores the saved canvas and returns to **Listening** immediately. The swallow-the-closing-touch dance is a reMarkable stylus-lifecycle detail; the pen-gate already prevents the same tap from drawing ink. Documented so the reviewer sees it is intentional.

---

## File structure (this plan)

- `js/statemachine.js` — **pure:** `initialState()`, `reduce(state, event)`, `oracleExcuse(errText)`, `triplesToPolylines(strokes)`, `planConjure(headProvider, replyProvider, entry, opts)`.
- `js/settings.js` — **pure:** `DEFAULT_SETTINGS`, `normalizeSettings(raw)`, `settingsToConfig(settings)`; **wiring:** `createSettingsStore(db)`, `showSettings(root, { store, onClose })`, `initSettingsGesture(canvas, { onOpen, holdMs, cornerFrac })`.
- `js/memory.js` — **modified:** `openMemoryDb` bumped to DB v2 (adds the `settings` store).
- `js/ink.js` — **modified:** `initInk` gains an optional `gate = { accepts(), onBlockedTap() }`.
- `js/app.js` — **wiring:** `initApp(canvas, { deps, db, font })` — the driver.
- `js/app-boot.js` — **replaced:** real boot (open DB, load font, register sw, first-launch settings, `initApp`).
- `index.html` — **modified:** manifest link, theme-color, apple-touch-icon.
- `manifest.webmanifest`, `sw.js`, `icons/icon.svg` — **new.**
- `README.md` — **new:** GitHub Pages deploy section.
- `tests/unit/statemachine-*.test.js`, `tests/unit/settings-*.test.js`, `tests/unit/conjure-plan.test.js` — Vitest.
- `tests/browser/*.spec.js`, `tests/browser/fixtures/*.html` — Playwright.

---

### Task 1: PWA shell — manifest, service worker, icon, index wiring

Stand up the installable shell first (independent of the state machine) and prove the service worker registers and precaches.

**Files:**
- Create: `tom-diary/manifest.webmanifest`, `tom-diary/sw.js`, `tom-diary/icons/icon.svg`
- Modify: `tom-diary/index.html`
- Create: `tom-diary/tests/browser/pwa.spec.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a registered service worker precaching the app shell; a linked manifest.

- [ ] **Step 1: Write the manifest**

Create `tom-diary/manifest.webmanifest`:

```json
{
  "name": "The Diary",
  "short_name": "Diary",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#f4ecd8",
  "theme_color": "#f4ecd8",
  "icons": [
    { "src": "./icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Write a simple self-contained icon**

Create `tom-diary/icons/icon.svg` (a cream page with a dark inkblot — no external refs):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f4ecd8"/>
  <circle cx="256" cy="256" r="120" fill="#33302a"/>
  <circle cx="352" cy="180" r="26" fill="#33302a"/>
</svg>
```

- [ ] **Step 3: Write the service worker (cache-first shell, network for the oracle)**

Create `tom-diary/sw.js`:

```js
// App-shell service worker: precache everything the diary needs to run offline.
// The oracle fetch is cross-origin and is never intercepted.
const CACHE = 'tom-diary-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/paper.css',
  './js/app-boot.js', './js/app.js', './js/statemachine.js', './js/settings.js',
  './js/ink.js', './js/commit.js', './js/help.js', './js/handwriting.js',
  './js/glyphs.js', './js/layout.js', './js/reveal.js', './js/dissolve.js',
  './js/skeleton.js', './js/oracle.js', './js/memory.js',
  './vendor/opentype.mjs', './fonts/DancingScript.ttf', './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle same-origin GETs; let the oracle (and any cross-origin) pass through.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
```

- [ ] **Step 4: Link the manifest + icon + theme in `index.html`**

Replace `tom-diary/index.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <title>The Diary</title>
  <meta name="theme-color" content="#f4ecd8" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <link rel="manifest" href="./manifest.webmanifest" />
  <link rel="apple-touch-icon" href="./icons/icon.svg" />
  <link rel="stylesheet" href="./css/paper.css" />
</head>
<body>
  <canvas id="page"></canvas>
  <script type="module" src="./js/app-boot.js"></script>
</body>
</html>
```

> `app-boot.js` still resolves (Plan 1's version) until Task 9 replaces it; the shell test only needs the sw to register.

- [ ] **Step 5: Register the sw from the current boot (temporary)**

Append to the existing `tom-diary/js/app-boot.js` (Plan 1 version), just before `document.body.dataset.ready = 'true';`:

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw failed', e));
}
```

- [ ] **Step 6: Write the browser test**

Create `tom-diary/tests/browser/pwa.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('manifest is linked and the service worker registers + precaches the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  }, null, { timeout: 10000 });

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return [];
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return reqs.map((r) => new URL(r.url).pathname);
  });
  expect(cached.some((p) => p.endsWith('/js/statemachine.js') || p.endsWith('/js/oracle.js'))).toBe(true);
  expect(cached.some((p) => p.endsWith('/fonts/DancingScript.ttf'))).toBe(true);
});
```

- [ ] **Step 7: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- pwa`
Expected: PASS (1 passed). If the sw does not activate, confirm Playwright is not blocking service workers (default Chromium allows them on `http://localhost`).

- [ ] **Step 8: Commit**

```bash
cd tom-diary && git add manifest.webmanifest sw.js icons/icon.svg index.html js/app-boot.js tests/browser/pwa.spec.js
git commit -m "feat(pwa): manifest + service worker shell cache + icon + index wiring"
```

---

### Task 2: Settings model — defaults, normalization, oracle config mapping

Pure serialization: apply defaults to a raw settings record, and map it to the `askOracle` config. No DB, no DOM.

**Files:**
- Create: `tom-diary/js/settings.js`
- Test: `tom-diary/tests/unit/settings-model.test.js`

**Interfaces:**
- Consumes: `DEFAULT_BASE`, `DEFAULT_MAX_TOKENS` (`js/oracle.js`); `memoryEnabled` (`js/memory.js`).
- Produces:
  - `DEFAULT_SETTINGS` — `{ base, key, model, reasoning, maxTokens, memory, tzOffset }`.
  - `normalizeSettings(raw) → settings` — fills missing fields with defaults; coerces `maxTokens`/`tzOffset` to numbers; leaves `key` empty when unset.
  - `settingsToConfig(settings) → { base, key, model, maxTokens, reasoning, remember }` — `remember = memoryEnabled(settings.memory)`; `reasoning` is `null` when blank (so `buildRequestBody` omits `reasoning_effort`).

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/settings-model.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, settingsToConfig } from '../../js/settings.js';

describe('normalizeSettings', () => {
  it('fills every field from defaults when given nothing', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.base).toBe('https://api.openai.com/v1');
    expect(s.maxTokens).toBe(2000);
    expect(s.memory).toBe('on');
    expect(s.tzOffset).toBe(0);
    expect(s.key).toBe('');
  });
  it('keeps provided values and coerces numeric fields', () => {
    const s = normalizeSettings({ key: 'sk-x', model: 'gpt-4o', maxTokens: '500', tzOffset: '-5.5', memory: 'off' });
    expect(s.key).toBe('sk-x');
    expect(s.model).toBe('gpt-4o');
    expect(s.maxTokens).toBe(500);
    expect(s.tzOffset).toBe(-5.5);
    expect(s.memory).toBe('off');
  });
});

describe('settingsToConfig', () => {
  it('maps to an askOracle config with remember from the memory toggle', () => {
    const c = settingsToConfig(normalizeSettings({ key: 'k', model: 'm', reasoning: 'low', memory: 'on' }));
    expect(c).toEqual({ base: 'https://api.openai.com/v1', key: 'k', model: 'm', maxTokens: 2000, reasoning: 'low', remember: true });
  });
  it('turns a blank reasoning into null and off memory into remember:false', () => {
    const c = settingsToConfig(normalizeSettings({ key: 'k', model: 'm', reasoning: '', memory: 'off' }));
    expect(c.reasoning).toBeNull();
    expect(c.remember).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/settings-model.test.js`
Expected: FAIL — `js/settings.js` / exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/settings.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/settings-model.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/settings.js tests/unit/settings-model.test.js
git commit -m "feat(settings): pure defaults/normalize + askOracle config mapping"
```

---

### Task 3: Settings store — DB v2 `settings` object store

Bump the memory DB to version 2 to add a `settings` store, and provide a tiny CRUD wrapper. Migration-safe: existing `pages` data survives. Tested under `fake-indexeddb`.

**Files:**
- Modify: `tom-diary/js/memory.js` (`openMemoryDb` → v2)
- Modify: `tom-diary/js/settings.js` (add `createSettingsStore`)
- Test: `tom-diary/tests/unit/settings-store.test.js`

**Interfaces:**
- Consumes: `normalizeSettings` (same module); an open `IDBDatabase`.
- Produces:
  - `openMemoryDb(factory?)` — now opens DB `tom-diary` **version 2** with object stores `pages` (keyPath `id`) and `settings` (keyPath `key`); creates each only if missing.
  - `createSettingsStore(db) → { load() → Promise<settings>, save(settings) → Promise<void> }` — the single record lives under key `'config'`; `load` returns `normalizeSettings` of the stored record (or the defaults when none).

- [ ] **Step 1: Bump `openMemoryDb` to version 2**

In `tom-diary/js/memory.js`, replace the `openMemoryDb` body with (note the version bump and the extra store; `pages` creation is preserved and guarded):

```js
/** Open (or create/upgrade) the DB. v2 adds the settings store beside pages. */
export function openMemoryDb(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 2: Add `createSettingsStore` to `settings.js`**

Append to `tom-diary/js/settings.js`:

```js
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
```

- [ ] **Step 3: Write the failing test**

Create `tom-diary/tests/unit/settings-store.test.js`:

```js
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openMemoryDb, createMemoryStore } from '../../js/memory.js';
import { createSettingsStore, DEFAULT_SETTINGS } from '../../js/settings.js';

let db;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openMemoryDb();
});

describe('settings store (DB v2)', () => {
  it('returns defaults before anything is saved', async () => {
    const s = createSettingsStore(db);
    expect(await s.load()).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips a saved record (normalized)', async () => {
    const s = createSettingsStore(db);
    await s.save({ key: 'sk-1', model: 'gpt-4o', maxTokens: '750', memory: 'off' });
    const loaded = await s.load();
    expect(loaded.key).toBe('sk-1');
    expect(loaded.maxTokens).toBe(750);
    expect(loaded.memory).toBe('off');
  });
  it('coexists with the pages store on the same DB', async () => {
    const mem = createMemoryStore(db);
    await mem.append(1751856000, 'hi', 'Hello.', [{ points: [{ x: 1, y: 1, r: 2 }] }]);
    const s = createSettingsStore(db);
    await s.save({ key: 'k' });
    expect((await mem.all())).toHaveLength(1);
    expect((await s.load()).key).toBe('k');
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `cd tom-diary && npx vitest run tests/unit/settings-store.test.js`
Expected: first FAIL (before Steps 1–2 applied), then PASS once applied. Also run `npx vitest run tests/unit/memory-store.test.js` to confirm the v2 bump did not break Plan 3's store tests.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/memory.js js/settings.js tests/unit/settings-store.test.js
git commit -m "feat(settings): DB v2 settings store + CRUD wrapper (fake-indexeddb)"
```

---

### Task 4: `oracleExcuse` — friendly error copy (pure)

Port `oracle_excuse` (`main.rs:773-790`) with the reMarkable "oracle.env" references adapted to "Settings". Used by the reducer to ink a friendly reply on any oracle failure or the patience timeout.

**Files:**
- Create: `tom-diary/js/statemachine.js`
- Test: `tom-diary/tests/unit/statemachine-excuse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `oracleExcuse(errText: string) → string`.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/statemachine-excuse.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { oracleExcuse } from '../../js/statemachine.js';

describe('oracleExcuse', () => {
  it('handles a missing key / no oracle', () => {
    expect(oracleExcuse('no oracle')).toContain('Settings');
    expect(oracleExcuse('no oracle')).toContain('dormant');
  });
  it('handles 401/403 as a refused key', () => {
    expect(oracleExcuse('http 401: bad key')).toContain('refused');
    expect(oracleExcuse('http 403: nope')).toContain('refused');
  });
  it('handles other http errors with the code', () => {
    expect(oracleExcuse('http 500: boom')).toContain('(http 500)');
  });
  it('handles network failure and timeout the same way', () => {
    expect(oracleExcuse('request failed: offline')).toContain('Wi-Fi');
    expect(oracleExcuse('timed out')).toContain('Wi-Fi');
  });
  it('handles empty reply and a generic fallback', () => {
    expect(oracleExcuse('empty reply')).toContain('said nothing');
    expect(oracleExcuse('the diary lost that page (show:9)')).toContain('ink blurred');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/statemachine-excuse.test.js`
Expected: FAIL — `js/statemachine.js` / `oracleExcuse` missing.

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/statemachine.js`:

```js
// The diary's brain: a pure 9-state reducer plus the pure helpers the driver
// composes (error copy, stroke conversion, conjure planning). No DOM, no
// canvas, no timers, no clock. Ported from riddle/src/main.rs's run() loop.
import { lingerMs } from './reveal.js';
import { planReply } from './layout.js';

/** Friendly reply for an oracle failure. Ported from main.rs:773-790, "oracle.env" -> "Settings". */
export function oracleExcuse(e) {
  if (e.includes('no oracle')) {
    return 'The diary lies dormant: it found no oracle. Set an API key in Settings, then write again.';
  }
  if (e.startsWith('http 401') || e.startsWith('http 403')) {
    return "The oracle refused the diary's key. Check the API key in Settings.";
  }
  if (e.startsWith('http ')) {
    const code = e.split(':')[0];
    return `The oracle rejected the diary's plea (${code}). Check the model and endpoint in Settings.`;
  }
  if (e.includes('request failed') || e.includes('timed out')) {
    return 'The diary cannot reach its oracle. Is the tablet connected to Wi-Fi?';
  }
  if (e.includes('empty reply')) {
    return 'The spirit read your words but said nothing. Write again.';
  }
  return 'The ink blurred before it could answer. Write again.';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/statemachine-excuse.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/statemachine.js tests/unit/statemachine-excuse.test.js
git commit -m "feat(app): oracleExcuse friendly error copy (web-adapted)"
```

---

### Task 5: The 9-state reducer — the core loop

The heart of Plan 4: a pure reducer covering Listening → Drinking → Thinking → Replying → Lingering → FadingReply → Listening, plus Help / Conjuring / MemoryShown and pen-tap dismissal. Oracle events during Drinking are buffered; the reply persists on completion; errors ink an excuse without persisting.

**Files:**
- Modify: `tom-diary/js/statemachine.js` (add `initialState`, `reduce`)
- Test: `tom-diary/tests/unit/statemachine-reduce.test.js`

**Interfaces:**
- Consumes: `oracleExcuse` (same module); `lingerMs` (`js/reveal.js`).
- Produces:
  - `initialState() → { name:'listening' }`.
  - `reduce(state, event) → { state, effects }` — pure. Event/effect vocabulary below.

**Event vocabulary** (dispatched by the driver): `commit{uri,region,id}`, `help`, `oracleInk{text}`, `oracleShow{id}`, `oracleTranscript{text}`, `oracleError{text}`, `oracleEnd`, `drinkDone`, `revealPlanned{totalPoints}`, `revealDrained`, `fadeDone`, `conjureDrained`, `helpDismissed`, `penTap`, `timer{name}`.

**Effect vocabulary** (executed by the driver): `clearInk`, `startOracle{uri}`, `dissolve{region,kind}` (`kind:'drink'|'fade'`), `blot{on}`, `write{text}`, `append{text}`, `persist{id,transcript,reply}`, `conjure{id}`, `restoreCanvas`, `clearScreen`, `openHelp`, `schedule{name,ms}`, `cancelTimer{name}`.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/statemachine-reduce.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../../js/statemachine.js';

// Drive a sequence of events, returning the final {state, effects-of-last-step}.
function run(events, start = initialState()) {
  let state = start;
  let effects = [];
  for (const ev of events) ({ state, effects } = reduce(state, ev));
  return { state, effects };
}
const types = (effects) => effects.map((e) => e.type);
const region = { x0: 10, y0: 10, x1: 100, y1: 100 };
const commit = { type: 'commit', uri: 'data:image/png;base64,AAA', region, id: 1751856000 };

describe('reduce — commit starts the drink and the oracle concurrently', () => {
  it('clears ink, starts the oracle, and dissolves — entering drinking', () => {
    const { state, effects } = reduce(initialState(), commit);
    expect(state.name).toBe('drinking');
    expect(state.id).toBe(1751856000);
    expect(types(effects)).toEqual(['clearInk', 'startOracle', 'dissolve']);
    expect(effects.find((e) => e.type === 'dissolve').kind).toBe('drink');
    expect(effects.find((e) => e.type === 'startOracle').uri).toBe(commit.uri);
  });
  it('a large-! help gesture opens the panel instead of committing', () => {
    const { state, effects } = reduce(initialState(), { type: 'help' });
    expect(state.name).toBe('help');
    expect(types(effects)).toEqual(['openHelp']);
  });
});

describe('reduce — oracle events during drinking are buffered until drinkDone', () => {
  it('buffers ink and, on drinkDone, writes it and enters replying', () => {
    const { state, effects } = run([
      commit,
      { type: 'oracleInk', text: 'Hello.' },
      { type: 'drinkDone' },
    ]);
    expect(state.name).toBe('replying');
    expect(state.reply).toBe('Hello.');
    expect(types(effects)).toContain('write');
    expect(effects.find((e) => e.type === 'write').text).toBe('Hello.');
  });
  it('with no oracle event yet, drinkDone enters thinking (blot + patience timer)', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }]);
    expect(state.name).toBe('thinking');
    expect(effects).toContainEqual({ type: 'blot', on: true });
    expect(effects).toContainEqual({ type: 'schedule', name: 'patience', ms: 120000 });
  });
  it('a buffered show:N leads straight to conjuring', () => {
    const { state, effects } = run([commit, { type: 'oracleShow', id: 42 }, { type: 'drinkDone' }]);
    expect(state.name).toBe('conjuring');
    expect(effects).toContainEqual({ type: 'conjure', id: 42 });
  });
});

describe('reduce — thinking', () => {
  it('first ink turns off the blot, cancels patience, and writes', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'oracleInk', text: 'Who writes?' }]);
    expect(state.name).toBe('replying');
    expect(effects).toContainEqual({ type: 'blot', on: false });
    expect(effects).toContainEqual({ type: 'cancelTimer', name: 'patience' });
    expect(effects).toContainEqual({ type: 'write', text: 'Who writes?' });
  });
  it('a transcript-only event keeps thinking and stores the transcript', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'oracleTranscript', text: 'it rained' }]);
    expect(state.name).toBe('thinking');
    expect(state.transcript).toBe('it rained');
    expect(effects).toEqual([]);
  });
  it('a show:N in thinking conjures', () => {
    const { state } = run([commit, { type: 'drinkDone' }, { type: 'oracleShow', id: 7 }]);
    expect(state.name).toBe('conjuring');
  });
  it('the patience timeout inks a "timed out" excuse (no persist)', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'timer', name: 'patience' }]);
    expect(state.name).toBe('replying');
    expect(state.failed).toBe(true);
    const w = effects.find((e) => e.type === 'write');
    expect(w.text).toContain('Wi-Fi'); // oracleExcuse('timed out')
  });
});

describe('reduce — replying → lingering (persist) → fading → listening', () => {
  it('appends streamed chunks and lingers only once the stream ends AND the reveal drains', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'drinkDone' });        // -> thinking
    r = reduce(r.state, { type: 'oracleInk', text: 'Hello.' }); // -> replying, write
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 80 });
    r = reduce(r.state, { type: 'oracleInk', text: 'Who writes?' }); // append
    expect(r.effects).toContainEqual({ type: 'append', text: 'Who writes?' });
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 120 });
    // reveal drains before the stream ends: stay replying
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('replying');
    // stream ends: now go to lingering, persist, schedule linger with the summed points
    r = reduce(r.state, { type: 'oracleEnd' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects).toContainEqual({ type: 'persist', id: 1751856000, transcript: '', reply: 'Hello. Who writes?' });
    expect(r.effects).toContainEqual({ type: 'schedule', name: 'linger', ms: Math.min(4000 + 200 * 2, 20000) });
  });
  it('a stored transcript rides along to persist', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'oracleInk', text: 'Hi.' });
    r = reduce(r.state, { type: 'drinkDone' });
    r = reduce(r.state, { type: 'oracleTranscript', text: 'the rain came' });
    r = reduce(r.state, { type: 'oracleEnd' });
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.find((e) => e.type === 'persist').transcript).toBe('the rain came');
  });
  it('the linger timer fades, and fadeDone returns to a blank listening page', () => {
    let r = reduce({ name: 'lingering', region }, { type: 'timer', name: 'linger' });
    expect(r.state.name).toBe('fading');
    expect(r.effects).toContainEqual({ type: 'dissolve', region, kind: 'fade' });
    r = reduce(r.state, { type: 'fadeDone' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'clearScreen' });
  });
  it('a pen tap during lingering fades early', () => {
    const r = reduce({ name: 'lingering', region }, { type: 'penTap' });
    expect(r.state.name).toBe('fading');
    expect(r.effects).toContainEqual({ type: 'cancelTimer', name: 'linger' });
    expect(r.effects).toContainEqual({ type: 'dissolve', region, kind: 'fade' });
  });
});

describe('reduce — an oracle error inks an excuse without persisting', () => {
  it('errors mid-thinking → replying(excuse), failed, no persist on drain', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'drinkDone' });
    r = reduce(r.state, { type: 'oracleError', text: 'http 401: bad key' });
    expect(r.state.name).toBe('replying');
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toContain('refused');
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.some((e) => e.type === 'persist')).toBe(false);
  });
});

describe('reduce — help / conjuring / memory dismissal', () => {
  it('help dismiss returns to listening', () => {
    const r = reduce({ name: 'help' }, { type: 'helpDismissed' });
    expect(r.state.name).toBe('listening');
  });
  it('conjureDrained rests in memory for 120s', () => {
    const r = reduce({ name: 'conjuring' }, { type: 'conjureDrained' });
    expect(r.state.name).toBe('memory');
    expect(r.effects).toContainEqual({ type: 'schedule', name: 'memory', ms: 120000 });
  });
  it('a pen tap while conjuring restores today\'s page and listens', () => {
    const r = reduce({ name: 'conjuring' }, { type: 'penTap' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'restoreCanvas' });
  });
  it('memory dismiss (tap or timer) restores and listens', () => {
    expect(reduce({ name: 'memory' }, { type: 'penTap' }).state.name).toBe('listening');
    const r = reduce({ name: 'memory' }, { type: 'timer', name: 'memory' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'restoreCanvas' });
  });
  it('ink events are ignored while drinking is not the concern (no crash on stray events)', () => {
    expect(reduce({ name: 'fading', region }, { type: 'penTap' }).state.name).toBe('fading');
    expect(reduce(initialState(), { type: 'oracleInk', text: 'x' }).state.name).toBe('listening');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/statemachine-reduce.test.js`
Expected: FAIL — `initialState` / `reduce` missing.

- [ ] **Step 3: Write the implementation**

Append to `tom-diary/js/statemachine.js`:

```js
export function initialState() {
  return { name: 'listening' };
}

const R = (state, effects = []) => ({ state, effects });

/** Enter replying with an initial batch of chunks (first uses write, rest append). */
function enterReplying({ id, transcript = '', chunks, failed = false, ended = false, extra = [] }) {
  const reply = chunks.join(' ').trim();
  const effects = [...extra, { type: 'write', text: chunks[0] }];
  for (const t of chunks.slice(1)) effects.push({ type: 'append', text: t });
  return R(
    { name: 'replying', id, transcript, reply, totalPoints: 0, drained: false, ended, failed },
    effects,
  );
}

/** Ink a friendly excuse as the reply; never persisted. */
function enterExcuse(id, rawError, extra = []) {
  const text = oracleExcuse(rawError);
  return R(
    { name: 'replying', id, transcript: '', reply: text, totalPoints: 0, drained: false, ended: true, failed: true },
    [...extra, { type: 'write', text }],
  );
}

/** After the drink, act on whatever the oracle buffered (or start thinking). */
function afterDrink(s) {
  if (s.show != null) return R({ name: 'conjuring' }, [{ type: 'conjure', id: s.show }]);
  if (s.error != null) return enterExcuse(s.id, s.error);
  if (s.chunks.length > 0) {
    return enterReplying({ id: s.id, transcript: s.transcript || '', chunks: s.chunks, ended: s.ended });
  }
  return R(
    { name: 'thinking', id: s.id, transcript: s.transcript || '' },
    [{ type: 'blot', on: true }, { type: 'schedule', name: 'patience', ms: 120000 }],
  );
}

/** Complete the turn: persist when eligible, then linger. */
function toLingering(s) {
  const effects = [];
  if (!s.failed && s.reply !== '') {
    effects.push({ type: 'persist', id: s.id, transcript: s.transcript || '', reply: s.reply });
  }
  effects.push({ type: 'schedule', name: 'linger', ms: lingerMs(s.totalPoints) });
  return R({ name: 'lingering', region: s.region || null }, effects);
}

export function reduce(state, ev) {
  switch (state.name) {
    case 'listening':
      if (ev.type === 'commit') {
        return R(
          {
            name: 'drinking', id: ev.id, region: ev.region,
            chunks: [], show: null, error: null, transcript: null, ended: false,
          },
          [{ type: 'clearInk' }, { type: 'startOracle', uri: ev.uri }, { type: 'dissolve', region: ev.region, kind: 'drink' }],
        );
      }
      if (ev.type === 'help') return R({ name: 'help' }, [{ type: 'openHelp' }]);
      return R(state);

    case 'drinking':
      if (ev.type === 'oracleInk') return R({ ...state, chunks: [...state.chunks, ev.text] });
      if (ev.type === 'oracleShow') return R({ ...state, show: ev.id });
      if (ev.type === 'oracleTranscript') return R({ ...state, transcript: ev.text });
      if (ev.type === 'oracleError') return R({ ...state, error: ev.text });
      if (ev.type === 'oracleEnd') return R({ ...state, ended: true });
      if (ev.type === 'drinkDone') return afterDrink(state);
      return R(state);

    case 'thinking':
      if (ev.type === 'oracleShow') {
        return R({ name: 'conjuring' }, [{ type: 'blot', on: false }, { type: 'cancelTimer', name: 'patience' }, { type: 'conjure', id: ev.id }]);
      }
      if (ev.type === 'oracleInk') {
        return enterReplying({
          id: state.id, transcript: state.transcript, chunks: [ev.text],
          extra: [{ type: 'blot', on: false }, { type: 'cancelTimer', name: 'patience' }],
        });
      }
      if (ev.type === 'oracleTranscript') return R({ ...state, transcript: ev.text });
      if (ev.type === 'oracleError') {
        return enterExcuse(state.id, ev.text, [{ type: 'blot', on: false }, { type: 'cancelTimer', name: 'patience' }]);
      }
      if (ev.type === 'timer' && ev.name === 'patience') {
        return enterExcuse(state.id, 'timed out', [{ type: 'blot', on: false }]);
      }
      return R(state);

    case 'replying': {
      if (ev.type === 'oracleInk') {
        return R({ ...state, reply: (state.reply + ' ' + ev.text).trim() }, [{ type: 'append', text: ev.text }]);
      }
      if (ev.type === 'oracleTranscript') return R({ ...state, transcript: ev.text });
      if (ev.type === 'revealPlanned') return R({ ...state, totalPoints: state.totalPoints + ev.totalPoints });
      if (ev.type === 'oracleError') return R({ ...state, ended: true, failed: true });
      if (ev.type === 'oracleEnd') {
        const next = { ...state, ended: true };
        return next.drained ? toLingering(next) : R(next);
      }
      if (ev.type === 'revealDrained') {
        const next = { ...state, drained: true };
        return next.ended ? toLingering(next) : R(next);
      }
      return R(state);
    }

    case 'lingering':
      if (ev.type === 'timer' && ev.name === 'linger') {
        return R({ name: 'fading', region: state.region }, [{ type: 'dissolve', region: state.region, kind: 'fade' }]);
      }
      if (ev.type === 'penTap') {
        return R({ name: 'fading', region: state.region }, [{ type: 'cancelTimer', name: 'linger' }, { type: 'dissolve', region: state.region, kind: 'fade' }]);
      }
      return R(state);

    case 'fading':
      if (ev.type === 'fadeDone') return R({ name: 'listening' }, [{ type: 'clearScreen' }]);
      return R(state);

    case 'help':
      if (ev.type === 'helpDismissed') return R({ name: 'listening' });
      return R(state);

    case 'conjuring':
      if (ev.type === 'conjureDrained') return R({ name: 'memory' }, [{ type: 'schedule', name: 'memory', ms: 120000 }]);
      if (ev.type === 'penTap') return R({ name: 'listening' }, [{ type: 'restoreCanvas' }]);
      return R(state);

    case 'memory':
      if (ev.type === 'penTap' || (ev.type === 'timer' && ev.name === 'memory')) {
        return R({ name: 'listening' }, [{ type: 'restoreCanvas' }]);
      }
      return R(state);

    default:
      return R(state);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/statemachine-reduce.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/statemachine.js tests/unit/statemachine-reduce.test.js
git commit -m "feat(app): pure 9-state reducer (core loop + help/conjure/memory)"
```

---

### Task 6: Conjure planning — `triplesToPolylines` + `planConjure` (pure)

Compose the conjured page: the spoken-date heading (54 px, near the top), the writer's own stored strokes (raw `[x,y,r]` triples → `[x,y]` polylines), and the old reply (96 px, below), into a single stroke plan the driver replays faded and fast. Pure — the glyph providers are injected, so it tests with stubs like `planReply`.

**Files:**
- Modify: `tom-diary/js/statemachine.js`
- Test: `tom-diary/tests/unit/conjure-plan.test.js`

**Interfaces:**
- Consumes: `planReply` (`js/layout.js`); layout providers (`{ measure, line, lineHeight }`).
- Produces:
  - `triplesToPolylines(strokes: Array<Array<[x,y,r]>>) → Array<Array<[x,y]>>` — drop the radius (`stepReveal` reads only `[x,y]`; the conjure replay uses the animator's uniform radius).
  - `planConjure(headProvider, replyProvider, entry, { screenW, screenH, headY = 64 }) → { strokes, region }` where `entry = { id, reply, dateText, strokes }` (`strokes` are stored triples). Order: **heading** (centered at `headY`) → **user strokes** (as stored, absolute coords) → **reply** (via `planReply` at `yStart = min(inkBottom + 130, screenH - 400)`). `region` is the union bbox padded by 5 px. Ported from `conjure` (`main.rs:795-857`).

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/conjure-plan.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { triplesToPolylines, planConjure } from '../../js/statemachine.js';

describe('triplesToPolylines', () => {
  it('drops the radius, keeping x,y in order', () => {
    expect(triplesToPolylines([[[1, 2, 3], [4, 5, 6]]])).toEqual([[[1, 2], [4, 5]]]);
  });
});

// Stub providers: each line is one horizontal 2-point stroke of `width`.
const headProvider = { lineHeight: 68, measure: (s) => s.length * 10, line: (s) => ({ width: s.length * 10, strokes: [[[0, 0], [s.length * 10, 0]]] }) };
const replyProvider = { lineHeight: 120, measure: (s) => s.length * 20, line: (s) => ({ width: s.length * 20, strokes: [[[0, 0], [s.length * 20, 0]]] }) };

describe('planConjure', () => {
  const entry = {
    id: 1751856000,
    dateText: 'the 7th of July, in the morning',
    reply: 'Hello again.',
    strokes: [[[300, 400, 2], [360, 460, 3]]], // the writer's own hand, mid-page
  };

  it('stacks heading, then user strokes, then reply, all in one plan', () => {
    const plan = planConjure(headProvider, replyProvider, entry, { screenW: 1000, screenH: 1200 });
    // heading first (near the top), user strokes present verbatim, reply below.
    expect(plan.strokes.length).toBeGreaterThanOrEqual(3);
    // the user's own strokes appear as [x,y] pairs, unchanged in position
    expect(plan.strokes).toContainEqual([[300, 400], [360, 460]]);
    // heading centered at headY (64): its first stroke starts at y=64
    const heading = plan.strokes[0];
    expect(heading[0][1]).toBe(64);
    // region covers the user ink and is padded
    expect(plan.region.x0).toBeLessThanOrEqual(300 - 5);
    expect(plan.region.y1).toBeGreaterThanOrEqual(460 + 5);
  });

  it('places the reply below the lowest user ink (inkBottom + 130)', () => {
    const plan = planConjure(headProvider, replyProvider, entry, { screenW: 1000, screenH: 1200 });
    const replyStroke = plan.strokes[plan.strokes.length - 1];
    // user ink bottom is y=460 -> reply starts near 460 + 130 = 590
    expect(replyStroke[0][1]).toBeGreaterThanOrEqual(560);
  });

  it('omits the reply block when the stored reply is empty', () => {
    const plan = planConjure(headProvider, replyProvider, { ...entry, reply: '' }, { screenW: 1000, screenH: 1200 });
    // heading (1) + one user stroke (1) = 2 strokes, no reply
    expect(plan.strokes.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/conjure-plan.test.js`
Expected: FAIL — `triplesToPolylines` / `planConjure` missing.

- [ ] **Step 3: Write the implementation**

Append to `tom-diary/js/statemachine.js`:

```js
/** Stored [x,y,r] triples -> [x,y] polylines for the reveal animator. */
export function triplesToPolylines(strokes) {
  return strokes.map((s) => s.map(([x, y]) => [x, y]));
}

/**
 * Build the conjured page's combined stroke plan: date heading (centered at
 * headY), the writer's own strokes, then the old reply below. Ported from
 * conjure() (main.rs:795-857). Providers are injected so this stays pure.
 */
export function planConjure(headProvider, replyProvider, entry, { screenW, screenH, headY = 64 }) {
  const strokes = [];
  let x0b = Infinity, y0b = Infinity, x1b = -Infinity, y1b = -Infinity;
  const grow = (x, y) => {
    x0b = Math.min(x0b, x - 5); y0b = Math.min(y0b, y - 5);
    x1b = Math.max(x1b, x + 5); y1b = Math.max(y1b, y + 5);
  };
  let inkBottom = headY;

  // Heading: centered horizontally at headY.
  const head = headProvider.line(entry.dateText);
  const headX = Math.round((screenW - head.width) / 2);
  for (const s of head.strokes) {
    const mapped = s.map(([sx, sy]) => [headX + sx, headY + sy]);
    for (const [x, y] of mapped) { grow(x, y); inkBottom = Math.max(inkBottom, y); }
    strokes.push(mapped);
  }

  // The writer's own hand, exactly as penned.
  for (const s of triplesToPolylines(entry.strokes)) {
    for (const [x, y] of s) { grow(x, y); inkBottom = Math.max(inkBottom, y); }
    strokes.push(s);
  }

  // Tom's old reply, below.
  if (entry.reply && entry.reply.trim() !== '') {
    const yStart = Math.min(inkBottom + 130, screenH - 400);
    const plan = planReply(entry.reply, replyProvider, { screenW, screenH, yStart });
    for (const s of plan.strokes) {
      for (const [x, y] of s) grow(x, y);
      strokes.push(s);
    }
  }

  const region = strokes.length ? { x0: x0b, y0: y0b, x1: x1b, y1: y1b } : null;
  return { strokes, region };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/conjure-plan.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/statemachine.js tests/unit/conjure-plan.test.js
git commit -m "feat(app): conjure plan (heading + user strokes + reply) + triples adapter"
```

---

### Task 7: Input gating — extend `initInk` with a state gate

Give `initInk` an optional `gate` so the driver can restrict ink to Listening and receive dismissal/interrupt taps in the other states. Default gate accepts everything (Plan 1 tests keep passing).

**Files:**
- Modify: `tom-diary/js/ink.js`
- Create: `tom-diary/tests/browser/fixtures/gate-harness.html`
- Test: `tom-diary/tests/browser/ink-gate.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `initInk(canvas, { onCommit, onHelp, idleMs, gate })` where `gate = { accepts() → boolean, onBlockedTap() }` — when `accepts()` is false at `pointerdown`, the event is swallowed (no ink, no idle timer) and `onBlockedTap()` fires. Default: `{ accepts: () => true, onBlockedTap: () => {} }`.

- [ ] **Step 1: Extend `initInk`**

In `tom-diary/js/ink.js`, change the `initInk` signature and the `pointerdown` handler. Replace:

```js
export function initInk(canvas, { onCommit, onHelp, idleMs = 2800 } = {}) {
```

with:

```js
export function initInk(canvas, { onCommit, onHelp, idleMs = 2800, gate } = {}) {
  const inkGate = gate || { accepts: () => true, onBlockedTap: () => {} };
```

and replace the `pointerdown` listener body's first lines:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (penDown) return; // ignore secondary/concurrent pointers (palm, 2nd finger)
```

with:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (penDown) return; // ignore secondary/concurrent pointers (palm, 2nd finger)
    if (!inkGate.accepts()) { inkGate.onBlockedTap(); return; } // only Listening writes ink
```

(Leave the rest of `initInk` unchanged.)

- [ ] **Step 2: Write the browser fixture**

Create `tom-diary/tests/browser/fixtures/gate-harness.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>gate harness</title>
<style>html,body{margin:0;height:100%}#page{display:block;width:400px;height:400px;touch-action:none}</style>
</head>
<body>
<canvas id="page"></canvas>
<script type="module">
  import { initInk } from '../../../js/ink.js';
  const canvas = document.getElementById('page');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  window.__accept = true;
  window.__taps = 0;
  const ink = initInk(canvas, {
    idleMs: 300,
    onCommit: () => { window.__committed = (window.__committed || 0) + 1; },
    gate: { accepts: () => window.__accept, onBlockedTap: () => { window.__taps++; } },
  });
  window.__strokeCount = () => ink.store.strokes.length;
  document.body.dataset.ready = 'true';
</script>
</body></html>
```

- [ ] **Step 3: Write the browser test**

Create `tom-diary/tests/browser/ink-gate.spec.js`:

```js
import { test, expect } from '@playwright/test';

async function penStroke(page, pts) {
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
  for (const p of pts.slice(1)) await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
}

test('gate blocks ink and reports a tap when not accepting', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/gate-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => { window.__accept = false; });
  await penStroke(page, [{ x: 100, y: 100 }, { x: 160, y: 120 }]);
  expect(await page.evaluate(() => window.__strokeCount())).toBe(0);
  expect(await page.evaluate(() => window.__taps)).toBe(1);

  await page.evaluate(() => { window.__accept = true; });
  await penStroke(page, [{ x: 100, y: 100 }, { x: 160, y: 120 }, { x: 220, y: 110 }]);
  expect(await page.evaluate(() => window.__strokeCount())).toBe(1);
});
```

- [ ] **Step 4: Run the browser test + Plan 1 regression**

Run: `cd tom-diary && npm run test:browser -- ink-gate && npm run test:browser -- ink-surface`
Expected: both PASS (the default gate keeps Plan 1's `ink-surface.spec.js` green).

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/ink.js tests/browser/fixtures/gate-harness.html tests/browser/ink-gate.spec.js
git commit -m "feat(ink): optional state gate on initInk (default accepts all)"
```

---

### Task 8: Settings panel UI + corner tap-and-hold gesture

The DOM panel and the corner long-press that opens it. Browser-tested.

**Files:**
- Modify: `tom-diary/js/settings.js` (add `showSettings`, `initSettingsGesture`)
- Modify: `tom-diary/css/paper.css` (panel styles)
- Create: `tom-diary/tests/browser/fixtures/settings-harness.html`
- Test: `tom-diary/tests/browser/settings.spec.js`

**Interfaces:**
- Consumes: `createSettingsStore`, `normalizeSettings` (same module).
- Produces:
  - `showSettings(root, { store, onClose }) → dismissFn` — renders a form pre-filled from `store.load()`, saves to `store.save()` on Save, calls `onClose(savedSettings)` and removes itself.
  - `initSettingsGesture(canvas, { onOpen, holdMs = 600, cornerFrac = 0.12 }) → () => void` — a pointer held for `holdMs` inside the top-left corner (a `cornerFrac × cornerFrac` fraction of the canvas) opens settings; movement out of the corner or an early release cancels. Returns a teardown function.

- [ ] **Step 1: Write the panel + gesture**

Append to `tom-diary/js/settings.js`:

```js
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
```

- [ ] **Step 2: Style the panel**

Append to `tom-diary/css/paper.css`:

```css
.settings-panel {
  position: fixed; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(244, 236, 216, 0.98); color: #33302a;
  font-family: Georgia, 'Times New Roman', serif;
}
.settings-form { width: min(90vw, 460px); display: flex; flex-direction: column; gap: 0.7rem; }
.settings-form h1 { font-size: 1.6rem; text-align: center; margin-bottom: 0.4rem; }
.settings-row { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.95rem; }
.settings-row input {
  font-size: 1rem; padding: 0.5rem; border: 1px solid #b9ad8f;
  background: #fbf6e9; color: #33302a; border-radius: 4px;
}
.settings-save {
  margin-top: 0.6rem; padding: 0.6rem; font-size: 1.05rem; cursor: pointer;
  background: #33302a; color: #f4ecd8; border: none; border-radius: 4px;
}
```

- [ ] **Step 3: Write the browser fixture + test**

Create `tom-diary/tests/browser/fixtures/settings-harness.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>settings harness</title>
<link rel="stylesheet" href="../../../css/paper.css">
<style>#page{display:block;width:400px;height:400px;touch-action:none}</style>
</head>
<body>
<canvas id="page"></canvas>
<script type="module">
  import { openMemoryDb } from '../../../js/memory.js';
  import { createSettingsStore, showSettings, initSettingsGesture } from '../../../js/settings.js';
  const db = await openMemoryDb();
  const store = createSettingsStore(db);
  const canvas = document.getElementById('page');
  window.__opened = 0;
  initSettingsGesture(canvas, {
    holdMs: 150,
    onOpen: () => { window.__opened++; showSettings(document.body, { store, onClose: (s) => { window.__saved = s; } }); },
  });
  document.body.dataset.ready = 'true';
</script>
</body></html>
```

Create `tom-diary/tests/browser/settings.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('corner hold opens settings; saving persists and closes', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Hold in the top-left corner (12% of 400px = ~48px).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });
  await expect(page.locator('.settings-panel')).toBeVisible({ timeout: 2000 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });

  await page.fill('input[name="key"]', 'sk-test');
  await page.fill('input[name="model"]', 'gpt-4o');
  await page.click('.settings-save');
  await expect(page.locator('.settings-panel')).toHaveCount(0);

  const saved = await page.evaluate(() => window.__saved);
  expect(saved.key).toBe('sk-test');
  expect(saved.model).toBe('gpt-4o');

  // Persisted: reopening loads the saved values.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 2 });
  await expect(page.locator('.settings-panel')).toBeVisible();
  await expect(page.locator('input[name="key"]')).toHaveValue('sk-test');
});
```

- [ ] **Step 4: Run the browser test**

Run: `cd tom-diary && npm run test:browser -- settings`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/settings.js css/paper.css tests/browser/fixtures/settings-harness.html tests/browser/settings.spec.js
git commit -m "feat(settings): panel UI + corner tap-and-hold gesture"
```

---

### Task 9: The driver — `initApp` wiring everything together

Compose the reducer + `initInk` (gated) + the reply writer + `askOracle` + the memory store + settings + the pulsing blot + the timers into the live app. Effects from `reduce` are executed here; real callbacks are dispatched back as events. `deps`/`db`/`font` are injectable so the e2e (Task 10) feeds a fake fetch and a seeded DB.

**Files:**
- Create: `tom-diary/js/app.js`
- Replace: `tom-diary/js/app-boot.js` (real boot)

**Interfaces:**
- Consumes: everything above + `createReplyWriter`, `runDissolve`, `DRINK_STAGES/STEP_MS`, `FADE_STAGES/STEP_MS`, `loadFont` (`js/handwriting.js`); `createGlyphCache` (`js/glyphs.js`); `createRevealAnimator` (`js/reveal.js`); `computeCommitBox` (`js/commit.js`); `askOracle` (`js/oracle.js`); `createMemoryStore`, `memoryEnabled`, `spokenDate` (`js/memory.js`); `createSettingsStore`, `settingsToConfig`, `showSettings`, `initSettingsGesture` (`js/settings.js`); `stampDot` (`js/reveal.js`, for the blot).
- Produces: `initApp(canvas, { deps = {}, db, font, settingsStore, idleMs = 2800 }) → { dispatch, getState }` (the returned handles are for tests).

- [ ] **Step 1: Write the driver**

Create `tom-diary/js/app.js`:

```js
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
import { createMemoryStore, spokenDate } from './memory.js';
import { createSettingsStore, settingsToConfig } from './settings.js';
import {
  initialState, reduce, triplesToPolylines, planConjure,
} from './statemachine.js';

const PAPER = '#f4ecd8';
const FADED = '#787878';

export function initApp(canvas, { deps = {}, db, font, settingsStore, idleMs = 2800 } = {}) {
  const ctx = canvas.getContext('2d');
  const cssW = () => canvas.clientWidth;
  const cssH = () => canvas.clientHeight;
  const paintPaper = () => { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cssW(), cssH()); };

  const memory = createMemoryStore(db, { offsetHours: 0 });
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

  const clearTimer = (name) => { if (timers.has(name)) { clearTimeout(timers.get(name)); timers.delete(name); } };

  function dispatch(ev) {
    const out = reduce(state, ev);
    state = out.state;
    for (const eff of out.effects) runEffect(eff);
  }

  function ink(store) { app.store = store; }
  const app = { dispatch, getState: () => state, store: null };

  // --- effect executors ---
  function runEffect(eff) {
    switch (eff.type) {
      case 'clearInk': app.store.clear(); break;
      case 'startOracle': startOracle(eff.uri); break;
      case 'dissolve': runDissolveEffect(eff.region, eff.kind); break;
      case 'blot': eff.on ? startBlot() : stopBlot(); break;
      case 'write': {
        const s = writer.write(eff.text, { onDone: () => dispatch({ type: 'revealDrained' }) });
        dispatch({ type: 'revealPlanned', totalPoints: s.totalPoints });
        break;
      }
      case 'append': {
        const s = writer.appendChunk(eff.text);
        dispatch({ type: 'revealPlanned', totalPoints: s.totalPoints });
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
    const { memoryEnabled } = await import('./memory.js');
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
      accepts: () => state.name === 'listening',
      onBlockedTap: () => dispatch({ type: 'penTap' }),
    },
  });
  ink(inkSurface.store);

  paintPaper();
  return app;
}
```

- [ ] **Step 2: Replace the boot with the real one**

Replace `tom-diary/js/app-boot.js` with:

```js
import { openMemoryDb } from './memory.js';
import { loadFont } from './handwriting.js';
import { createSettingsStore } from './settings.js';
import { showSettings, initSettingsGesture } from './settings.js';
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

initApp(canvas, { db, font, settingsStore });

// A corner long-press opens settings any time.
initSettingsGesture(canvas, { onOpen: () => showSettings(document.body, { store: settingsStore, onClose: () => {} }) });

// First launch with no key: open settings straight away.
const current = await settingsStore.load();
if (!current.key) showSettings(document.body, { store: settingsStore, onClose: () => {} });

document.body.dataset.ready = 'true';
```

- [ ] **Step 3: Manual smoke via `serve` (no automated assertion here; Task 10 e2e covers it)**

Run: `cd tom-diary && npm run serve` and open `http://localhost:8080` in a browser with a real key entered in Settings; confirm the write → drink → reply → linger → fade loop runs. (This step is a manual check; the automated end-to-end is Task 10.)

- [ ] **Step 4: Commit**

```bash
cd tom-diary && git add js/app.js js/app-boot.js
git commit -m "feat(app): initApp driver wiring reducer + ink + writer + oracle + memory + settings"
```

---

### Task 10: End-to-end browser tests — the core loop and conjure (mocked oracle)

Prove the whole app end-to-end in a real browser with a **fake fetch** feeding a canned SSE stream (no network). One spec drives write → drink → thinking → reply → linger → fade; another drives a `⟦show:N⟧` conjure of a seeded memory.

**Files:**
- Create: `tom-diary/tests/browser/fixtures/app-harness.html`
- Create: `tom-diary/tests/browser/app-e2e.spec.js`

**Interfaces:**
- Consumes: `initApp` with an injected `deps.fetch`, a seeded settings key, and (for conjure) a seeded memory page.
- Produces: the plan's integration deliverable.

- [ ] **Step 1: Write the harness (fake SSE fetch, seeded settings, exposed hooks)**

Create `tom-diary/tests/browser/fixtures/app-harness.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>app e2e harness</title>
<link rel="stylesheet" href="../../../css/paper.css">
</head>
<body>
<canvas id="page" style="width:800px;height:600px"></canvas>
<script type="module">
  import { openMemoryDb } from '../../../js/memory.js';
  import { createSettingsStore } from '../../../js/settings.js';
  import { createMemoryStore } from '../../../js/memory.js';
  import { loadFont } from '../../../js/handwriting.js';
  import { initApp } from '../../../js/app.js';

  const canvas = document.getElementById('page');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);

  // Build a fake streaming Response from SSE chunks decided by window.__sse().
  function sseResponse(chunks) {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); c.close(); } });
    return { status: 200, ok: true, body, text: async () => '' };
  }
  const fakeFetch = async () => sseResponse(window.__sse());

  const db = await openMemoryDb();
  const settingsStore = createSettingsStore(db);
  await settingsStore.save({ key: 'sk-test', model: 'm', memory: 'on' });
  window.__memory = createMemoryStore(db, { offsetHours: 0 });

  const font = await loadFont('../../../fonts/DancingScript.ttf');
  const app = initApp(canvas, { deps: { fetch: fakeFetch }, db, font, settingsStore, idleMs: 200 });
  window.__app = app;
  window.__inkPixels = () => {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (luma < 100) n++;
    }
    return n;
  };
  document.body.dataset.ready = 'true';
</script>
</body></html>
```

- [ ] **Step 2: Write the e2e spec**

Create `tom-diary/tests/browser/app-e2e.spec.js`:

```js
import { test, expect } from '@playwright/test';

async function penStroke(page, pts) {
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
  for (const p of pts.slice(1)) await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
}

test('write -> drink -> reply -> linger -> fade returns to a listening blank page', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const S = '⁂'; // ⁂
    window.__sse = () => [
      'data: {"choices":[{"delta":{"content":"Hello. "}}]}\n',
      'data: {"choices":[{"delta":{"content":"Who writes to me? "}}]}\n',
      `data: {"choices":[{"delta":{"content":"${S} it rained all night"}}]}\n`,
      'data: [DONE]\n',
    ];
  });

  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);

  // The reply is inked (black pixels appear), then the turn is remembered.
  await page.waitForFunction(() => window.__app.getState().name === 'replying' || window.__app.getState().name === 'lingering', null, { timeout: 5000 });
  await expect.poll(() => page.evaluate(() => window.__inkPixels()), { timeout: 5000 }).toBeGreaterThan(200);

  // Wait for the reply to finish and linger.
  await page.waitForFunction(() => window.__app.getState().name === 'lingering', null, { timeout: 8000 });
  const remembered = await page.evaluate(async () => (await window.__memory.all()).map((e) => e.transcript));
  expect(remembered).toContain('it rained all night');

  // Tap to fade early, then it dissolves back to a blank listening page.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 50, clientY: 50, pointerType: 'pen', isPrimary: true, pointerId: 2 });
  await page.waitForFunction(() => window.__app.getState().name === 'listening', null, { timeout: 5000 });
});

test('a leading show:N conjures a seeded memory and returns on a tap', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Seed one earlier page so the catalog has an entry (⟦show:1⟧ -> it).
  await page.evaluate(async () => {
    await window.__memory.append(1751856000, 'about the rain', 'The ink blurred, but I felt it.', [{ points: [{ x: 120, y: 300, r: 3 }, { x: 220, y: 360, r: 2 }] }]);
    const O = '⟦', C = '⟧', S = '⁂';
    window.__sse = () => [
      `data: {"choices":[{"delta":{"content":"${O}show:1${C}"}}]}\n`,
      `data: {"choices":[{"delta":{"content":"\\n${S} show me the rain page"}}]}\n`,
      'data: [DONE]\n',
    ];
  });

  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);

  await page.waitForFunction(() => window.__app.getState().name === 'conjuring' || window.__app.getState().name === 'memory', null, { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.__inkPixels()), { timeout: 8000 }).toBeGreaterThan(50);
  await page.waitForFunction(() => window.__app.getState().name === 'memory', null, { timeout: 8000 });

  // A pen tap returns to today's (blank) page.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 50, clientY: 50, pointerType: 'pen', isPrimary: true, pointerId: 3 });
  await page.waitForFunction(() => window.__app.getState().name === 'listening', null, { timeout: 5000 });
});
```

- [ ] **Step 3: Run the e2e**

Run: `cd tom-diary && npm run test:browser -- app-e2e`
Expected: PASS (2 tests). If the reply never inks, confirm the fake fetch's `body` is a real `ReadableStream` and that `deps.fetch` reached `askOracle` (log inside `startOracle`).

- [ ] **Step 4: Run the FULL suite (Plans 1–4)**

Run: `cd tom-diary && npm test && npm run test:browser`
Expected: every Vitest unit spec and every Playwright browser spec passes.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add tests/browser/fixtures/app-harness.html tests/browser/app-e2e.spec.js
git commit -m "test(app): end-to-end write->reply->fade and show:N conjure (fake SSE)"
```

---

### Task 11: Deploy doc — GitHub Pages

A short README section so anyone can serve the diary and add it to a home screen.

**Files:**
- Create: `tom-diary/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: deploy instructions.

- [ ] **Step 1: Write the README**

Create `tom-diary/README.md`:

```markdown
# tom-diary

A browser reimplementation of [riddle](https://github.com/MaximeRivest/riddle) —
Tom Riddle's diary as an installable PWA for iPad and other tablets. Write with
a pen; rest; the diary drinks your ink and replies in animated handwriting.

## Run locally

```bash
npm install
npx playwright install chromium   # for the browser tests
npm test           # unit (Vitest + jsdom)
npm run test:browser  # browser (Playwright)
npm run serve      # http://localhost:8080
```

Open the served URL, hold the top-left corner to open **Settings**, and enter
your OpenAI-compatible API key, base URL, and model. On first launch with no key
the Settings panel opens automatically. Everything else runs client-side; only
the reply call needs network.

## Deploy to GitHub Pages

The app is static files with **no build step**, so Pages serves the repo as-is.

1. Push to `jumbomochi/tom-diary` on GitHub.
2. Settings → Pages → Build and deployment → **Deploy from a branch**, branch
   `main`, folder `/ (root)`. Save.
3. Wait for the deploy; the app is at `https://jumbomochi.github.io/tom-diary/`.
   All asset paths are **relative** (`./…`), so it works from that subpath.
4. On the iPad, open that URL in Safari once, then **Share → Add to Home
   Screen**. The manifest (`display: standalone`) launches it fullscreen, and
   the service worker caches the shell (HTML/CSS/JS, the font, `opentype.mjs`)
   so it opens offline — only the oracle call needs Wi-Fi.

## How it works

- `js/ink.js` — pen capture, live ink, scribble-erase, idle-commit, the "!" help gesture.
- `js/commit.js` — crop/downscale the page to a black-on-white PNG.
- `js/handwriting.js` (+ `glyphs/layout/reveal/skeleton/dissolve`) — glyph
  rasterize → Zhang-Suen thin → centerline trace → animated brush reveal + dissolve.
- `js/oracle.js` — OpenAI-compatible streaming, the persona/memory prompts, the SSE parser.
- `js/memory.js` — IndexedDB pages, the catalog, `spoken_date`, conjure lookup.
- `js/statemachine.js` — the pure 9-state reducer.
- `js/app.js` — the driver wiring it all together.
```

- [ ] **Step 2: Commit**

```bash
cd tom-diary && git add README.md
git commit -m "docs: README with GitHub Pages deploy + Add to Home Screen"
```

---

## Open risks / things to validate during implementation

- **`putImageData` conjure restore vs. DPR.** `conjure` snapshots with `getImageData(0,0,canvas.width,canvas.height)` (device px) and restores with `putImageData` — correct because both use the backing store, bypassing the DPR transform. But the conjure *drawing* (`planConjure` output, `createRevealAnimator`) uses the CSS-px transformed context. Confirm on a real high-DPR iPad that the restore is pixel-exact and the faded replay lands where expected.
- **Oracle events racing the drink.** The reducer buffers `oracleInk/Show/Error/End` during Drinking and acts on `drinkDone`. If the whole stream completes (including `oracleEnd`) before the drink finishes, `afterDrink` still routes correctly (chunks present → replying with `ended:true`). Watch a very fast/cached provider to confirm no event is dropped.
- **`persist` re-loads settings.** `persist` re-reads `settings.load()` for the memory toggle; a user toggling memory off mid-turn would then skip the save. Acceptable (matches "nothing saved when off"), but note the read is async — the turn's `commitSnapshot` is captured at commit, so the strokes are correct regardless.
- **Blot repaint over reply region.** The thinking blot clears a 28×28 box at screen center each pulse; if a streamed reply begins writing near center the blot's final clear could nick it. riddle clears the blot once on the first event (`main.rs:489`); the driver does the same via `stopBlot` before `write`. Confirm the order (blot off precedes write) holds — it does, because the reducer emits `{blot:false}` before `{write}` in the thinking→replying transition.
- **Settings gesture vs. ink capture.** `initSettingsGesture` listens in the **capture** phase so a corner long-press is seen before `initInk`; a normal quick corner stroke still draws (the hold timer cancels on move-out or early release). Tune `holdMs`/`cornerFrac` by hand so it neither eats real writing nor is hard to trigger.
- **Service worker staleness.** `sw.js` precaches by a versioned cache name (`tom-diary-v1`); bumping any shipped asset requires bumping that string or users get the old shell. Note for future changes; not a Plan-4 defect.
- **CORS for browser SSE** (carried from Plan 3): some OpenAI-compatible providers omit CORS headers, surfacing as `request failed` (→ the "cannot reach its oracle" excuse). Test against OpenAI and OpenRouter on a real device.

---

## Self-review notes

**1. Spec coverage — every spec section and all 9 states + timings:**

- **Core interaction loop** (spec §"Core interaction loop") — idle-commit → PNG → oracle → handwriting reply: Tasks 5 (reducer), 9 (driver wiring `initInk`/`computeCommitBox`/`askOracle`/`createReplyWriter`), 10 (e2e). ✅
- **Animation states & timing** (spec §"Animation states and timing"), all 9 states with verbatim constants:
  - **Listening** (only state that accepts ink) → Task 7 gate + Task 5 reducer + Task 9 `gate.accepts = state==='listening'`. ✅
  - **Drinking** (14×70ms dissolve, oracle concurrent, buffered) → Task 5 (`commit`→drinking, buffering, `afterDrink`) + Task 9 (`runDissolveEffect` DRINK, `startOracle` fired on the same commit). ✅
  - **Thinking** (blot 600ms, ORACLE_PATIENCE 120s) → Task 5 (`blot`/`schedule patience`, `timer:patience`→excuse) + Task 9 (`startBlot` 600ms, radius-9 blot). ✅
  - **Replying** (26pts/14ms reveal, append streamed chunks, persist on completion) → Task 5 (`write`/`append`, `revealPlanned`, drain+end→lingering+persist) + Task 9 (`createReplyWriter`). ✅
  - **Lingering** (4000+points*2, cap 20s; pen tap dismisses) → Task 5 (`lingerMs`, `schedule linger`, `penTap`→fading). ✅
  - **FadingReply** (10×80ms, ends blank) → Task 5 (`fading`, `fadeDone`→listening+`clearScreen`) + Task 9 (`runDissolveEffect` FADE). ✅
  - **Help** → Task 5 (`help`→openHelp, `helpDismissed`) + Task 9 (`showHelpPanel`). ✅
  - **Conjuring** (48pts/10ms faded #787878 replay, heading 54px + user strokes + reply 96px) → Tasks 5 (`conjure` effect), 6 (`planConjure`/`triplesToPolylines`), 9 (`createRevealAnimator` 48/10 FADED). ✅
  - **MemoryShown** (120s; tap returns to today's page) → Task 5 (`conjureDrained`→memory+`schedule memory`, `penTap`/`timer:memory`→restore) + Task 9 (`restoreCanvas`). ✅
- **Memory & conjuring** (transcript→`memory.append`, conjure replay of stored decimated triples, restore) → Tasks 5, 6, 9. ✅
- **Streamed reply routing** (leading `⟦show:N⟧`→conjure vs prose→ink; error→excuse) → the parser (Plan 3) drives `onShow`/`onInk`/`onError`; the reducer routes them (Tasks 4, 5). ✅
- **Settings** (key/base/model/reasoning/maxTokens/memory/tz-offset in IndexedDB; corner tap-and-hold; first-launch open) → Tasks 2 (model), 3 (DB v2 store), 8 (panel + gesture), 9/boot (first-launch). ✅
- **PWA & deployment** (manifest standalone + warm theme, sw caches shell incl. font + opentype.mjs, GitHub Pages) → Tasks 1 (manifest/sw/icon), 11 (deploy doc). ✅
- **Cross-plan obligations:** page id = `Math.floor(Date.now()/1000)` (Task 9 `commit` event; Global Constraints) ✅; clear store after commit (Task 5 `clearInk`) ✅; input gating (Task 7) ✅; `runDissolve` CSS-px region (Task 9 recompute from snapshot) ✅; oracle concurrent with drink (Task 5) ✅.

**2. Placeholder scan:** No "TBD", no "add error handling", no "similar to Task N". Every code step is complete runnable code (the reducer, the driver, the panel, the sw, the manifest, both e2e specs). The one manual step (Task 9 Step 3) is explicitly a manual smoke, with the automated coverage in Task 10. ✅

**3. Type consistency across tasks & vs. the real prior-plan signatures:**
- **Reducer event/effect shapes** are produced and consumed identically: the driver (Task 9) emits exactly the events the reducer (Task 5) switches on, and executes exactly the effects the reducer returns. ✅
- **`initInk(canvas, { onCommit, onHelp, idleMs, gate })`** — the `gate` field is added in Task 7 and supplied in Task 9; `onCommit(uri, snapshot)` matches the verified Plan 1 signature; `snapshot` (`{points:[{x,y,r}]}[]`) feeds `computeCommitBox` (Plan 1) and `memory.append` (Plan 3), both of which take that exact shape. ✅
- **`computeCommitBox` → `{x0,y0,w,h,...}`** (CSS px) is converted to the `{x0,y0,x1,y1}` region `runDissolve` wants (Task 9). ✅
- **`createReplyWriter().write/appendChunk` → `{ region, totalPoints, lingerMs }`** — the driver reads `totalPoints` and feeds `revealPlanned`; the reducer sums them and calls `lingerMs` (Plan 2 export). ✅
- **`askOracle(config, turn, handlers, deps)`** — `config` from `settingsToConfig` (Task 2), `turn` `{imageDataUri, history, catalogLines, catalogIds}` from `memory.catalog`/`recentDialogue` (Plan 3), `handlers` dispatch reducer events, `deps.fetch` injected in the e2e (Task 10). `onShow(id)` receives the resolved id (Plan 3 parser maps `catalogIds[N-1]`). ✅
- **`memory.strokes(id)` → `[x,y,r]` triples** feed `triplesToPolylines` (Task 6), never the live `{points:[…]}` shape — matching Plan 3's flagged risk. ✅
- **Settings record `{base,key,model,reasoning,maxTokens,memory,tzOffset}`** flows `createSettingsStore.load` → `settingsToConfig` → `askOracle` config, and `memoryEnabled(settings.memory)` gates persistence — all against the verified Plan 3 `memoryEnabled` / `DEFAULT_BASE` / `DEFAULT_MAX_TOKENS` exports. ✅
- **`createRevealAnimator(ctx, {pointsPerTick,tickMs,radius,color,onDone})`** — used at 48/10/`#787878` for conjure, its `setPlan(Array<Array<[x,y]>>)` fed by `planConjure` (which yields `[x,y]` pairs, including triples reduced by `triplesToPolylines`); `stepReveal` reads only `[x,y]`. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-tom-diary-04-app-settings-pwa.md`. This is plan 4 of 4 — the final plan. It consumes the merged Plans 1–3 (`initInk`, `computeCommitBox`/`renderCommitPng`, `createReplyWriter`/`runDissolve`, `askOracle`, the memory store) and completes the app: the pure `statemachine.js` reducer, the `app.js` driver, `settings.js`, and the PWA shell. After execution the diary runs end-to-end and installs on an iPad home screen.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
</content>
</invoke>
