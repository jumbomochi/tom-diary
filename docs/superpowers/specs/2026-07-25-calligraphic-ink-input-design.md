# tom-diary — calligraphic ink input + coordinate-offset fix

Status: design approved in brainstorming; ready for implementation planning.
Date: 2026-07-25

## Background

The core interaction of `tom-diary` is handwriting on a full-screen `<canvas>`.
Two problems in the current input surface (`js/ink.js`, `js/app-boot.js`)
degrade that experience:

1. **Cursor↔ink offset.** The finger/pen position and where the ink lands
   drift apart after the viewport changes. Root cause: `resize()` in
   `app-boot.js` runs exactly once at load and sizes the canvas backing store
   (`canvas.width/height` + the DPR `setTransform`) to the boot-time viewport.
   There is no `resize` / `visualViewport` / `orientationchange` listener. When
   the viewport later changes size — mobile URL bar hiding/showing on scroll,
   rotation, on-screen keyboard, desktop window resize, or a move to a
   different-DPR monitor — CSS stretches the canvas to the new
   `clientWidth/clientHeight`, but pointer coordinates (derived from
   `getBoundingClientRect`) now map into a coordinate space still scaled for
   the old size. The result is a consistent scale+offset between pointer and
   ink that appears "at times" (right after a viewport shift). On mobile Safari
   the `100vh` canvas + URL-bar show/hide triggers this routinely.

2. **"Multiple dots" feel.** `feed()` stamps a single isolated `ctx.arc` per
   pointer sample, with no interpolation between samples. Fast movement spaces
   samples apart, so a stroke reads as a dotted trail rather than continuous
   ink. (Tom's reply reveal already connects points with `brushLine`; only the
   user's own input ink is rendered as loose discs.)

The user chose the most ambitious rendering upgrade: **full calligraphic ink**
— a variable-width filled outline that tapers with pressure/velocity, like a
real nib — via the `perfect-freehand` algorithm.

## Goals

- Fix the cursor↔ink coordinate offset across all viewport-change events.
- Replace the loose-disc input rendering with continuous, variable-width
  calligraphic ink (`perfect-freehand`).
- Keep the existing stroke data model (points + pressure) canonical so that
  erase, commit-box, the commit PNG, and memory persistence/conjure are
  unaffected in logic.
- Make on-screen ink, the PNG sent to the oracle, and conjured ink use one
  shared stroke renderer so they look identical.
- Preserve offline/PWA behaviour (precache the new dependency; bump the SW
  cache version).

## Non-goals

- Tom's reply reveal, the thinking blot, dissolve/fade, and pacing/timing are
  explicitly out of scope ("replies and pause are OK for now").
- No change to the erase gesture semantics, the exclamation-for-help gesture,
  the settings gesture, or the state machine.
- No rewrite of the stroke/erase/commit geometry — see the note below.

## Key design decision: keep points canonical, change only rendering

The "perfect-freehand" option carries an apparent risk of rewriting the stroke
model and everything coupled to it (erase, commit-box, commit PNG, memory).
We avoid that: the canonical stroke stays a list of input points; only the
*painting* of a stroke changes.

- A stroke remains `{ points: [{ x, y, pressure }] }`. The only data change is
  storing raw `pressure` (0..1) per point instead of the pre-clamped radius
  `r`. `pressureToRadius` is removed from the input path (the outline generator
  now owns width). Any consumer that needs a nominal radius for geometry
  (e.g. `computeCommitBox` padding) uses a constant nominal half-width.
- `eraseStrokes`, `isEraserStroke`, `computeCommitBox`, memory persistence, and
  conjure all keep operating on points — unchanged in logic.

## Architecture

### Shared stroke renderer

A single pure-ish helper renders one stroke's outline:

```
renderStroke(ctx, points, { color, size, thinning, streamline, smoothing,
                            simulatePressure, last }) 
  → getStroke(points, opts) → outline polygon → ctx.fill()
```

Used in the two paths that render the user's own ink, so the look is
identical in both:
- live drawing and `repaint()` (on-screen ink),
- `renderCommitPng` (the image sent to the oracle).

Conjure replay is intentionally excluded: it animates a past page's strokes
stroke-by-stroke in faded gray via the existing reveal animator, and is out of
scope for width fidelity. It stays on its current path unchanged.

Pressure handling: pass real pen `pressure` when `pointerType === 'pen'`;
otherwise set `simulatePressure: true` so width tapers with velocity for
finger/mouse (nib feel without a pressure sensor).

### Offscreen ink layer + live-draw loop

`perfect-freehand` recomputes the *entire* stroke outline as the stroke grows
(the tail tapers), so additive fills leave artifacts at the moving tail. The
standard fix:

- An offscreen `inkLayer` canvas (device-pixel sized, DPR transform applied)
  holds all committed strokes as freehand fills.
- `pointerdown`: begin collecting raw points for the in-progress stroke.
- `pointermove` (throttled to `requestAnimationFrame`; use
  `getCoalescedEvents()` to capture sub-frame samples): blit `inkLayer` → main
  canvas, then fill the in-progress stroke's *current* outline on top.
- `pointerup`: bake the finished stroke into `inkLayer`, blit to main, and push
  its points into the stroke store (for erase/commit/memory).
- `repaint()`: rebuild `inkLayer` from the store (paper fill + every stroke),
  blit to main. Called after erase, resize, and settings-close.

The main `<canvas>` remains the single pixel surface that dissolve/reveal/blot
already read and write; `inkLayer` is an internal scratch buffer that is only
composited during the listening/drawing state.

### Coordinate-offset fix (resize handling)

- `initApp` exposes a `resize()` method that: recomputes DPR, resizes **both**
  the main canvas and `inkLayer`, re-applies `setTransform(dpr,0,0,dpr,0,0)` on
  both contexts, and calls `repaint()` to rebuild from the store (so committed
  ink survives the resize instead of being cleared to blank).
- `app-boot.js` registers a debounced handler (≈100ms trailing) on
  `window` `resize`, `window.visualViewport` `resize` (when present), and
  `orientationchange`, all calling `app.resize()`. The initial `resize()` call
  stays.

### Dependency + offline

- Vendor `perfect-freehand` as a single ESM file `vendor/perfect-freehand.mjs`
  (same pattern as `vendor/opentype.mjs`). MIT-licensed, ~4KB, no build step.
- Add `./vendor/perfect-freehand.mjs` to the `SHELL` precache array in `sw.js`.
- Bump the SW cache name `tom-diary-v1` → `tom-diary-v2` so returning visitors
  receive the new shell (the `activate` handler already purges old caches).

## File-by-file changes

- `js/ink.js` — replace disc rendering with the shared `renderStroke`; store
  `pressure` instead of `r`; add the `inkLayer` + rAF live-draw loop; add
  `getCoalescedEvents`; expose `repaint`/resize-rebuild to the driver; remove
  `pressureToRadius` from the input path.
- `js/render-stroke.js` (new) — the shared `renderStroke` helper wrapping
  `getStroke`.
- `js/commit.js` — `renderCommitPng` uses `renderStroke` for consistency; keep
  `computeCommitBox` (points ± nominal half-width; existing 20px pad covers the
  outline overshoot).
- `js/app.js` — thread the resize/rebuild hook; `initApp` returns `resize()`.
- `js/app-boot.js` — debounced resize/visualViewport/orientationchange listener
  → `app.resize()`.
- `vendor/perfect-freehand.mjs` (new) — vendored library.
- `sw.js` — add the vendor file to `SHELL`; bump cache to `tom-diary-v2`.

## Testing

- vitest (jsdom): pointer-event → canvas-coordinate mapping helper (the
  `getBoundingClientRect` math), and stroke-store erase-then-rebuild produces
  the expected remaining points. `getStroke` itself is trusted (external lib).
- Playwright smoke: draw a stroke, simulate a viewport resize
  (`page.setViewportSize`), draw again at a known point, assert ink pixels
  appear at/near the pointer location (offset regression guard) and that the
  first stroke's pixels survive the resize.

## Acceptance criteria

- After rotating / resizing / toggling the mobile URL bar, a pointer at (x,y)
  lands ink at (x,y) — no drift.
- A fast stroke renders as continuous, variable-width ink with no dotted gaps.
- Finger/mouse strokes taper naturally (simulated pressure); pen strokes use
  real pressure.
- Erase, commit-to-oracle, and memory conjure behave exactly as before.
- The app still loads and runs offline after the SW cache bump.

## Open risks / things to validate during implementation

- Live-draw performance on a full page: rebuilding `inkLayer` only on
  stroke-end (not per-frame) should keep per-frame cost to one blit + one
  outline fill. Validate on a dense page / low-end tablet.
- `perfect-freehand` option tuning (`size`, `thinning`, `streamline`,
  `smoothing`) to match the diary's ink weight against the cream paper.
- Confirm the vendored ESM build imports cleanly with no bundler (as
  `opentype.mjs` does).
- `computeCommitBox` overshoot: verify the freehand outline never exceeds the
  20px pad at max width; widen the pad or derive the box from the outline if it
  does.
