# tom-diary — web port of riddle, for iPad and other tablets

Status: approved (brainstorming), ready for implementation planning.
Date: 2026-07-22

## Background

[`riddle`](https://github.com/MaximeRivest/riddle) is a Rust app for the
reMarkable Paper Pro: you write on the e-ink page with a pen; after a 2.8s
pause, it rasterizes your ink to a PNG, sends it to a vision LLM persona'd as
Tom Riddle's diary, and writes the reply back onto the page in an animated
handwritten script, stroke by stroke, then fades it. It also remembers past
pages and can "conjure" one back (rewriting it on the page) when asked in
ink, and shows a help panel when a large "?" is drawn.

This spec defines `tom-diary`, a from-scratch browser reimplementation of the
same experience, aimed at iPad (and other tablets) with Apple Pencil or
finger input, deployed as an installable PWA on GitHub Pages. It is a new,
separate repository — not a fork of `riddle` — so `riddle` can keep tracking
its upstream independently.

Full fidelity was chosen as the target: every user-facing feature of the
original should have a web-native equivalent, except pieces that only make
sense on reMarkable hardware (see Non-goals).

## Goals

- Same core loop: write → idle-triggered commit → vision-LLM reply → the
  reply appears as animated handwriting, then fades.
- Same persona and memory-protocol behavior (ported verbatim from
  `oracle.rs`), including LLM-driven page conjuring and "what do you
  remember?".
- Same "?" gesture for a help panel, detected with the same geometry
  heuristic as `help.rs`, working fully offline.
- An erase gesture usable without a hardware eraser button: scribble-to-erase.
- Runs entirely client-side (static HTML/CSS/JS, no server), configured with
  the user's own OpenAI-compatible API key.
- Installable as a fullscreen PWA on the iPad home screen; app shell works
  offline, only the LLM call needs network.
- Warm, low-glow "paper" visual style rather than a bright white/blue UI.

## Non-goals

- The `pi`-backend oracle option (a resident local process — not meaningful
  in a browser; the OpenAI-compatible HTTP path covers the same ground).
- reMarkable-specific hardware gestures: 5-finger-tap-to-leave, power-button
  sleep/suspend, hardware eraser tool detection. Closing the tab/app is the
  web equivalent of "leaving."
- Multi-device sync or a shared backend. Memory and settings live in one
  browser's IndexedDB; each device you install it on has its own diary.
- Any change to the `riddle` repository itself.

## Architecture

Vanilla HTML/CSS/JS, no framework, no build step. One vendored dependency:
`opentype.js`, used to extract Dancing Script's glyph outlines as ready-made
vector pen paths for the handwriting animation (see below) — this replaces
the original's rasterize → Zhang-Suen skeletonize → stroke-trace pipeline,
which isn't worth porting to JS when the font already gives us vector paths.

Repository: new sibling repo at `~/GitHub/hp-diary/tom-diary`, pushed to
GitHub as `jumbomochi/tom-diary`, served by GitHub Pages.

```
tom-diary/
  index.html
  manifest.webmanifest       PWA manifest (standalone display, warm theme color)
  sw.js                      service worker: caches the app shell
  css/paper.css              warm paper theme, layout
  js/
    ink.js                   stroke capture (Pointer Events), rendering, scribble-erase detection
    commit.js                idle detection, crop/rasterize strokes to a PNG data URI
    oracle.js                API calls, persona/memory-protocol prompts, SSE streaming parser
    handwriting.js           opentype.js glyph-path extraction + stroke-order reveal animation
    memory.js                IndexedDB: pages, catalog building, conjure
    help.js                  "?" gesture geometry heuristic, guide panel
    settings.js               API key/model/base URL form, stored in IndexedDB
    app.js                    state machine wiring the above together
  fonts/DancingScript.ttf     same font as the original (SIL OFL 1.1)
  vendor/opentype.min.js
```

## Core interaction loop

**Ink capture** (`ink.js`): a full-screen `<canvas>` listens for Pointer
Events (`pointerdown`/`pointermove`/`pointerup`). Works for Apple Pencil
(`pointerType: 'pen'`, real `event.pressure`) and finger
(`pointerType: 'touch'`, pressure defaulted to a constant). `touch-action:
none` on the canvas stops Safari from scrolling/zooming while writing. Each
stroke is an array of `{x, y, r}` points; `r = 2 + pressure * 3` (matches
`main.rs`'s pressure→radius mapping). Strokes render immediately in dark
warm-gray ink on a cream paper background.

**Idle commit** (`commit.js`): a 2.8s idle timer starts on pen-up and resets
on any new pen-down, matching `IDLE_COMMIT` in `main.rs`. On fire (and only
if there's non-erased ink): crop to the ink's bounding box + padding, draw
onto an offscreen canvas, downscale so the long side is ≤800px (same as the
original), export as a PNG data URI directly from canvas — no framebuffer
scraping needed since we already hold vector strokes. If the page was fully
scribble-erased before the pause, the commit is cancelled (matches
`region_all_white`).

**Oracle call** (`oracle.js`): `fetch()` with `stream: true` against the
user's configured OpenAI-compatible endpoint (default
`https://api.openai.com/v1`). System prompt = `PERSONA` +
`MEMORY_PROTOCOL`, ported verbatim from `oracle.rs`. Message list = system +
recent (transcript, reply) history pairs + a user message carrying the
numbered memory catalog as text plus the page PNG as an `image_url` data
URI. The SSE stream is parsed incrementally, mirroring `StreamParser`:

- A leading `⟦show:N⟧` directive (the model's entire reply) routes to
  conjuring page N.
- Prose is cut into sentences as they arrive (on `.!?…` + whitespace, min
  length ~4 chars) and each sentence is handed to the handwriting animator
  as it becomes available — so ink starts appearing before the reply
  finishes streaming.
- A trailing line starting with `⁂` is the verbatim transcription postscript
  and is stored with the page instead of inked.

If the call fails (no key configured, network error, provider error), the
error text becomes Tom's "reply" instead — matching "Tom writes the reason
on the page." No retry loop; the user can just write again.

**Handwriting reply** (`handwriting.js`): each sentence is line-wrapped and
centered (mirroring `plan_reply`, including a small per-line y-wobble for a
handwritten feel). `opentype.js` provides each glyph's outline as a path —
already the "pen strokes," no rasterize/skeletonize/trace step needed. An
animation reveals each glyph's path progressively, left to right
(incremental `stroke-dashoffset` on an SVG path, or equivalent point-by-point
canvas drawing), paced to read as ink being written rather than text
appearing. After a pause, the reply fades — same "writes itself, then
fades" beat as the original.

## Memory and conjuring

**Storage** (`memory.js`): one IndexedDB object store keyed by page id
(commit timestamp). Each record: `{id, transcript, reply, strokes, date}`.
`strokes` is the raw vector ink for that page, so conjuring replays the
writer's *actual* handwriting rather than re-synthesizing it — matching the
original's behavior where only the reply text goes through handwriting
synthesis. Capped at 400 pages; oldest pruned first when the cap is
exceeded. A settings toggle (mirrors `RIDDLE_MEMORY=off`) disables all
storage and catalog-building — nothing saved, nothing extra sent.

**Catalog**: each turn, build the same newest-first numbered catalog the
original sends (gist = transcript/reply truncated, a human-readable spoken
date), and include it in the oracle request. `catalog_ids[i]` maps catalog
number `i+1` back to a page id, exactly as in `memory.rs`.

**Conjuring**: when the model's entire reply is `⟦show:N⟧`, map N → page id
via the catalog, then: fade the current page out, replay that page's stored
strokes (the writer's original handwriting) in faded ink, then replay its
stored reply through the handwriting animator, also faded — the "page rises
through the paper" effect. Touching the pen anywhere returns to today's
(current, in-progress) page.

**"What do you remember?"**: no special client-side handling — the model
answers in prose, drawing on the catalog it was given, same as the original.

## Gestures

**"?" for help** (`help.js`): `looksLikeQuestionMark(strokes)` ports
`help::looks_like_question_mark` from `help.rs` line-for-line — the same
bounding-box, stroke-count, and arc-shape geometry checks on raw (uncommitted)
strokes. Purely local, no LLM call, works fully offline. On match, shows a
guide panel (adapted text — see Content below); touching the pen anywhere
dismisses it back to writing, without triggering a commit.

**Scribble-to-erase** (`ink.js`): a stroke is classified as an eraser stroke
instead of ink when it has enough direction reversals per unit path length
(a fast back-and-forth zigzag) — the same gesture used in Notes/Procreate.
Eraser strokes brush the canvas white and remove/split the corresponding
points out of any stored stroke data so erased ink is neither shown nor
remembered, matching `ink.rs`'s erase behavior.

## Settings

A small panel, not part of the normal writing surface, opened by a
tap-and-hold in one corner of the screen (keeps the page itself
chrome-free). Fields: API key, base URL, model, reasoning effort, max
tokens, memory on/off, timezone offset — the same knobs as `oracle.env`.
Stored in IndexedDB (not localStorage, so it isn't subject to the same
practical size pressure as stroke/memory data and lives alongside it). On
first launch, with no key configured, the app opens straight to this panel.

## PWA and deployment

- `manifest.webmanifest`: name "The Diary", `display: standalone`, warm
  cream `theme_color`/`background_color`, home-screen icon.
- `sw.js`: caches the app shell (HTML/CSS/JS, the font, `opentype.min.js`)
  so the app launches instantly and the writing/animation loop works
  offline; only the oracle `fetch()` itself needs connectivity.
- Deployment: `jumbomochi/tom-diary` on GitHub, GitHub Pages serving from
  the repo, giving a stable HTTPS URL (required for "Add to Home Screen" to
  launch fullscreen and for the service worker to register). Open that URL
  in Safari on the iPad once, add to home screen, done.

## Content ported verbatim from the Rust source

- `PERSONA` and `MEMORY_PROTOCOL` strings from `oracle.rs`.
- The sentence-cutting / `⟦show:N⟧` / `⁂transcript` streaming grammar from
  `StreamParser` in `oracle.rs`.
- The pressure→radius mapping and idle-commit timeout from `main.rs`.
- The crop/pad/downscale-to-≤800px rule from `ink.rs`'s `commit`.
- The "?" detection geometry from `help.rs`.
- The catalog-building and pruning rules from `memory.rs`.

The help panel's gesture list is adapted for the web (dropping the
5-finger-tap/power-button lines, keeping write/rest-pen, "show me…", and
scribble-to-erase).

## Open risks / things to validate during implementation

- Whether Safari's Pointer Events give usable, distinguishable pressure
  values for Apple Pencil vs. finger in practice (fallback: treat all input
  as uniform-pressure ink if not).
- SSE streaming via `fetch()` works against OpenAI directly, but some
  OpenAI-compatible providers may not set CORS headers for browser calls —
  worth testing against at least OpenAI and OpenRouter early.
- Whether the scribble-erase heuristic needs tuning once tried by hand (it's
  new, unlike everything else here which is a direct port).
