# tom-diary — web port of riddle, for iPad and other tablets

Status: revised after source audit; open decisions resolved — handwriting =
port the skeleton pipeline (option A); help gesture = a large "!" sized
relative to the canvas. Ready for implementation planning.
Date: 2026-07-22 (revised 2026-07-22 after auditing the riddle source)

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
- A help panel summoned by a large "!" gesture (a canvas-relative adaptation
  of the original's "?" heuristic), working fully offline.
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

Vanilla HTML/CSS/JS, no framework, no build step.

**Handwriting synthesis — decided: port the pipeline (option A).** The
original (`script.rs`) rasterizes each glyph, runs Zhang-Suen thinning to a
**1px medial-axis skeleton**, traces that into single polylines down the
*center* of each pen stroke, and animates a round radius-2 brush along them.
tom-diary reproduces this in JS rather than animating font outlines directly:
a font outline is the *contour* of the filled letterform (two boundary paths
per stroke, plus inner contours for counters), so animating it would draw
hollow, perimeter-traced glyphs in the wrong order — not the single-pen-stroke
look. `opentype.js` alone does not give "free pen paths."

`handwriting.js` therefore: (1) rasterizes each glyph to an offscreen canvas
(`opentype.js` outline → `Path2D` fill, or `ctx.fillText` with Dancing Script),
(2) reads `ImageData` and runs Zhang-Suen thinning to a 1px skeleton, (3) traces
the skeleton into ordered centerline polylines — endpoint-first, sorted
left-to-right, dropping fragments under 3 points (per `script.rs:128-196`) —
then (4) animates a round brush along those polylines (pacing/layout below).
`opentype.js` remains the dependency, used for glyph metrics/kerning and to
feed outlines into the rasterizer. To keep live replies smooth, **cache each
glyph's traced polylines by (char, size)** so the thin/trace cost is paid once
per glyph, not once per reply.

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
    handwriting.js           glyph rasterize → Zhang-Suen thin → trace to centerlines + animated reveal
    memory.js                IndexedDB: pages, catalog building, conjure
    help.js                  "!" gesture heuristic (relative to canvas height), guide panel
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
stroke is an array of `{x, y, r}` points.

Pressure→radius, ported from `main.rs:345`: `r = 2 + pressure * 3` where
`pressure` is the **normalized** 0..1 value (the Rust code divides raw
pressure by `MAX_PRESSURE`; Pointer Events' `event.pressure` is already
normalized, so no divisor is needed here). This yields a radius of **2–5px**,
not the unbounded value the earlier `2 + pressure*3` wording implied for raw
pressure. Two more details from the original to match: (1) a contact only
counts as ink above a pressure gate (`pressure > 40` of 4096 raw, i.e.
`event.pressure` above ~0.01) — below that it is treated as pen-up, not a
faint stroke; (2) radius growth is smoothed along a stroke, capped at
`prev_r + 1` per point (`ink.rs:41`). Note the original never draws with a
finger at all — touch is only used for the 5-finger quit gesture (dropped
here, see Non-goals); making finger input draw with constant pressure is a
deliberate web-port addition, not a port of existing behavior.

Strokes render immediately in dark warm-gray ink on a cream paper background.

**Idle commit** (`commit.js`): a 2.8s idle timer (`IDLE_COMMIT = 2800ms`,
`main.rs:37`). Precisely: the timer measures time since the last pen *sample of
any kind* (it resets on every pen point, not only pen-down — `main.rs:354`) and
only fires while the pen is up. On fire, before treating it as a commit the
strokes are first checked against the two local gestures — a large "!" opens
the help panel and a fully-erased page cancels — so the commit path runs only for
genuine ink (see Gestures and the state list below).

Commit geometry, ported from `ink.rs:116-141`: crop to the ink bounding box,
pad by exactly **20px** per side (clamped to canvas bounds), then downscale by
an integer factor `max(ceil(longside / 800), 2)` — note the **minimum 2×**,
which applies even to small pages, so the PNG is never sent at 1:1. The
original box-filter-averages during downscale and emits 8-bit **grayscale**
(black ink on white); a canvas `drawImage` downscale into a grayscale-looking
export is close enough, but keep it black-on-white, not the cream paper color,
since that is what the model was persona-tuned against. Export as a PNG data
URI directly from canvas — no framebuffer scraping, since we hold vector
strokes.

"Fully erased" cancellation mirrors `region_all_white` (`main.rs:757-769`): a
page counts as empty when no pixel in the ink bbox is darker than luma 200
(equivalently, after scribble-erase, when no ink points remain).

**Oracle call** (`oracle.js`): POST to `{base}/chat/completions` (base default
`https://api.openai.com/v1`, trailing slash trimmed) with headers
`Authorization: Bearer {key}` and `Content-Type: application/json` only. The
request body carries exactly (`oracle.rs:480-499`): `model`, `stream: true`,
the token cap, `messages`, and — **only when the user configured a reasoning
effort** — `reasoning_effort`. Notably the original sends **no `temperature`
or `top_p`**; don't add them. Two fidelity details:

- **Token-cap field fallback.** Send `max_tokens` first; if the response is
  HTTP 400 whose body mentions `max_completion_tokens`, retry the request once
  with the field renamed to `max_completion_tokens` (`oracle.rs:479-520`).
  Newer OpenAI models require this rename, so keep the one-shot retry.
- **Timeouts.** Original uses a 10s connect timeout and a 90s per-read
  timeout (silence between chunks), with no overall deadline and no
  network-error retry. Approximate with an `AbortController` on connect and an
  idle-timeout reset on each chunk.

**System prompt** = `PERSONA`, with `MEMORY_PROTOCOL` appended **only when
memory is on** (`oracle.rs:447-451`), both `const` strings ported verbatim.
No dates or catalog go in the system prompt.

**Message list**: system, then recent history, then the current user turn.

- *History* = the last N finished pages (`recent_dialogue`, `memory.rs:159-170`),
  oldest-first, **skipping any page whose transcript is empty**. Each is a
  plain-string user message `"(an earlier page) {transcript}"` — **text only,
  no image** — and (for the HTTP backend) is followed by the assistant's prior
  reply. Only the *current* turn carries an image. N is a config value
  ("recent turns", `RIDDLE_MEMORY_TURNS` in `oracle.env`); it is applied by the
  caller, not inside `oracle.rs`.
- *Current turn* = a user message with a content array `[text, image_url]`. The
  text is the catalog block:
  `"Memory catalog (newest first):\n{lines}\n\nReply to what is written in the
  diary."` (with memory off it degrades to just
  `"Reply to what is written in the diary."` and no catalog). The image is
  `{"url": "data:image/png;base64,…"}` with **no `detail` field**.

The SSE stream is parsed incrementally, mirroring `StreamParser`. Feed the
parser the **full accumulated text every chunk** (both original backends
re-feed the running string, not raw deltas), reading only `choices[].delta.content`
(reasoning deltas are ignored); `data:` lines only, `[DONE]` ends the stream,
then a final flush pass. Behavior:

- A `⟦show:N⟧` directive routes to conjuring page N — **but only when it leads
  the reply** (after trimming leading whitespace, before any prose). A `⟦…⟧`
  that appears *after* prose is silently stripped and never inked
  (`oracle.rs:101-147`). `show` is the only directive; a malformed or
  out-of-range N surfaces as an error reply ("the diary lost that page …").
- Prose is cut into ink chunks on a sentence boundary (`.!?…` followed by
  whitespace/end). `sentence_cut` takes the **last** boundary available each
  pass, so a chunk may batch several sentences; the minimum is ~4 *bytes* past
  the last-delivered offset, not 4 characters. Each chunk also has one wrapping
  pair of leading/trailing double-quotes stripped and is trimmed
  (`oracle.rs:580-624`). Chunks are handed to the animator as they arrive, so
  ink starts before the stream finishes.
- A trailing line starting with `⁂` is the verbatim transcription postscript:
  emitted once, at stream end, only if non-empty, and stored with the page
  instead of inked.
- An empty / whitespace-only reply is an error ("empty reply"), as is an
  unfinished `⟦…⟧` at stream end.

If the call fails (no key configured, network error, provider error, or any of
the parser errors above), the error text becomes Tom's "reply" and is inked on
the page — matching "Tom writes the reason on the page." No retry loop beyond
the single `max_completion_tokens` rename; the user can just write again.

**Handwriting reply** (`handwriting.js`): layout ported from `plan_reply`
(`main.rs:861-892`), which is more specific than "centered":

- Font size `REPLY_PX = 96` (ab_glyph px-scale — the pixel height of the em
  box, *not* a CSS `font-size`; calibrate `opentype.js` `unitsPerEm` scaling to
  match), line height `= floor(REPLY_PX * 1.25) = 120px`, kerning applied.
- Greedy word-wrap at `max_w = SCREEN_W - 2*MARGIN_X` (`MARGIN_X = 120`).
  **No hyphenation**; a single word wider than `max_w` overflows the margin
  rather than breaking; `\n` in the reply is preserved as a hard line break.
- Lines are centered **horizontally** on their advance-width, but placed in the
  **upper third vertically**: the block starts at `y = max((SCREEN_H -
  total_h)/3, 60)`, and streamed continuation chunks stack downward from there
  (not vertically centered). If a chunk would run past `SCREEN_H - 200`, the
  original drops the trailing text.
- Per-line y-wobble is a **deterministic integer ±3px whole-line shift**, from
  an LCG seeded with the fixed constant `0x1234`
  (`seed = seed*1664525 + 1013904223; wobble = ((seed>>16) % 7) - 3`). It is
  the same sequence every reply, applied once per line — **not** `Math.random()`
  and **not** per-glyph jitter.

The synthesized ink is drawn as **solid black, uniform radius-2, hard-edged
round stamps** — no anti-aliasing, no opacity ramp, no pressure/width taper,
and no color other than black (the faded gray is only for conjured memories,
see below). Reveal pacing (`Replying`, `main.rs:589-636`): ~26 centerline
points every 14ms (≈1850 px/s), continuous — there are **no** inter-glyph,
inter-word, or inter-sentence pauses; the only boundaries are stroke starts.
The reveal follows the traced centerline polylines produced by the pipeline
above.

After the reply finishes it does **not** immediately fade — see the state list
for the linger-then-dissolve sequence.

## Animation states and timing

The original is a 9-state machine (`main.rs:61-77`), and the transitions
between "write" and "reply appears" carry the app's signature beats — the
earlier draft collapsed them into "appears, then fades." A faithful port needs
these states. Values below are the original's; treat them as the fidelity
target, tunable if a beat feels wrong on a bright tablet screen.

- **Listening** — the writing surface. The *only* state that accepts pen ink;
  during Drinking/Thinking/Replying pen input is ignored (you cannot write over
  a reply in progress). Idle-commit and the "?" gesture are evaluated here.
- **Drinking** — *"the diary drinks your ink."* On commit, the PNG is captured
  and then the user's own strokes visibly **dissolve away** over 14 stages ×
  70ms (~1s). This is a dither-dissolve (an increasing per-pixel subset erased
  each stage), not an alpha fade. The oracle `fetch()` runs concurrently with
  this animation to hide its latency. This beat is central and was missing from
  the earlier draft — it is the app's tagline.
- **Thinking** — while awaiting the first ink chunk, a small blot pulses at
  screen center (toggles ~every 600ms). A patience timeout (`ORACLE_PATIENCE
  = 120s`) turns into a "timed out" excuse written as the reply.
- **Replying** — the handwriting reveal (pacing/layout above). Streamed chunks
  append as they arrive. On completion, the finished turn is persisted to
  memory.
- **Lingering** — the completed reply rests on screen for `4000ms +
  points*2ms`, capped at 20s (`points` = total centerline point count, not
  character count). A pen tap during Lingering dismisses early → FadingReply.
- **FadingReply** — the reply **dissolves** over 10 stages × 80ms (~800ms),
  same dither mechanic as Drinking (a speckly grain, *not* a smooth CSS opacity
  fade), ending on a **blank page** → back to Listening. If matching the exact
  grain is not worth it, a short dissolve/fade is acceptable, but note it ends
  blank — nothing of the reply persists visibly.
- **Help / Conjuring / MemoryShown** — the "!" help panel and memory replay;
  see Gestures and Memory below.

The commit → Drinking → Thinking → Replying → Lingering → FadingReply →
Listening cycle is the core loop; `app.js` owns this state machine.

## Memory and conjuring

**Storage** (`memory.js`): one IndexedDB object store keyed by page id
(commit timestamp). Record: `{id, transcript, reply, strokes}` — note the
**date is derived from `id`, not stored** (the original's `Entry` is just
`{id, transcript, reply}`, with strokes in a separate per-page file;
`memory.rs:27-33`). `strokes` is the raw vector ink, so conjuring replays the
writer's *actual* handwriting rather than re-synthesizing it — matching the
original, where only the reply text goes through handwriting synthesis. Two
fidelity details from `memory.rs`: strokes are **decimated** before saving
(drop any point within √9 = 3px of the previously kept point, always keeping
each stroke's last point; `MIN_POINT_DIST2 = 9`), and each stored point keeps
its radius, i.e. `[x, y, r]` triples. Capped at `MAX_MEMORIES = 400` pages;
oldest pruned first when the cap is exceeded. A settings toggle (mirrors
`RIDDLE_MEMORY`, whose off-values are `off | 0 | no | false`) disables all
storage *and* catalog/history-building — nothing saved, nothing extra sent.

**Catalog**: each turn, build the same newest-first numbered catalog the
original sends and include it in the current user turn. Exact format
(`memory.rs:179-190`), one line per page:

```
{i+1}. {spoken_date(id)} — {gist}
```

with an em-dash separator. `gist` = the transcript with all whitespace
collapsed to single spaces, then the first **70 Unicode chars** (no ellipsis);
if the transcript is blank, `gist` falls back to `(reply: {first 70 chars of
reply})`. `spoken_date` renders like `the 6th of July, in the evening` —
ordinal day + month name + a time-of-day bucket (`0–4` "in the small hours",
`5–11` "in the morning", `12–17` "in the afternoon", `18–21` "in the evening",
`22–23` "late at night"); the **year is intentionally omitted**. The date uses
UTC plus the configured `RIDDLE_TZ_OFFSET` hours (float; the original's "local
time via libc" comment is misleading — it is UTC + offset). `catalog_ids[i]`
maps catalog number `i+1` back to a page id, and the `⟦show:N⟧` lookup is
`catalog_ids[N-1]`.

**Conjuring**: when a *leading* `⟦show:N⟧` directive is parsed, map N → page id
via the catalog, then: fade the current page out, write the page's **spoken
date as a heading** (at 54px, smaller than the 96px reply size), replay that
page's stored strokes (the writer's original handwriting), then replay its
stored reply through the handwriting animator. All of it is drawn in **faded
gray ink** (the original's `FADED`, ~`#787878`), and the replay is animated
**faster** than a live reply (~48 points every 10ms vs 26/14ms) — the "page
rises through the paper" effect. The conjured page then rests (`MemoryShown`)
for up to 120s. Touching the pen anywhere — during the replay or the rest —
returns to today's (current, in-progress) page, which is restored exactly as
it was.

**"What do you remember?"**: no special client-side handling — the model
answers in prose, drawing on the catalog it was given, same as the original.

## Gestures

**"!" for help** (`help.js`): a large exclamation mark opens the guide panel.
This replaces the original's "?" gesture — a deliberate change, because a "!"
is both simpler and more robust to detect (a tall near-vertical bar plus an
optional dot, versus the arc/curvature tests a "?" needs) and lets the size
gate be defined **relative to the canvas**, sidestepping the resolution/DPI
portability problem the original's absolute-pixel "?" thresholds would have had
on an iPad.

`looksLikeExclamation(strokes)` (a tom-diary original, not a port of
`help.rs`): accept **1–2 strokes**; the main stroke is the longest by point
count and must be (a) at least **20% of the active canvas height** tall,
(b) clearly taller than wide — near-vertical, small x-spread relative to
y-spread, and (c) roughly straight top-to-bottom (not an arc). An optional
second stroke counts as the dot only if it is small and sits low, near the main
stroke's x-center. Tune the exact ratios by hand (see Open risks).

It is evaluated at idle-commit *before* the commit path; on match the ink is
discarded (not sent to the oracle) and the panel opens. Purely local, no LLM
call, works fully offline. The panel auto-dismisses after ~45s or when the pen
touches the page; dismissal returns to writing without triggering a commit.

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

- `PERSONA` and `MEMORY_PROTOCOL` strings from `oracle.rs` (both static
  `const`s; MEMORY_PROTOCOL appended only when memory is on).
- The `StreamParser` grammar from `oracle.rs`: leading-only `⟦show:N⟧`, the
  last-boundary sentence cut, quote-stripping, `⁂transcript` postscript, and
  the error strings — as corrected in Oracle call above.
- The pressure→radius mapping (normalized, 2–5px) and `IDLE_COMMIT = 2800ms`
  from `main.rs`.
- The crop / 20px-pad / **min-2×** grayscale downscale from `ink.rs`'s
  `commit`.
- The reply layout, wobble, and animation timings from `plan_reply` /
  the state machine in `main.rs` (Animation states above).
- (The help gesture is deliberately NOT ported from `help.rs`; tom-diary uses
  its own canvas-relative "!" heuristic — see Gestures.)
- The catalog format, `spoken_date`, stroke decimation, and pruning rules from
  `memory.rs`.

The help panel's gesture list is adapted for the web. The original has two
variants (`help.rs:99-127`); the windowed one is the closest starting point:

```
The Diary                                         (title)

Write, then rest your quill:
the diary drinks your ink and Tom replies.

The diary remembers. Ask it:
"show me what I wrote about..."
and the page will rise again.

Flip the marker to erase.
Close the diary from AppLoad.

A large ! summons this guide.

Touch pen to page to close.                       (footer)
```

Adapt for the web by replacing the two reMarkable-specific lines: change
"Flip the marker to erase." → a scribble-to-erase instruction, and drop /
replace "Close the diary from AppLoad." (there is no AppLoad; closing the tab
is "leaving"). Also change the "A large ? summons this guide." line to "!" to
match the gesture. Keep the write/rest, "show me…", help-gesture, and "touch to
close" lines. (The original's takeover variant additionally has "Tap five fingers at
once to leave." and "The power button sleeps the diary." — both dropped here
per Non-goals.)

## Open risks / things to validate during implementation

- Whether Safari's Pointer Events give usable, distinguishable pressure
  values for Apple Pencil vs. finger in practice (fallback: treat all input
  as uniform-pressure ink if not).
- SSE streaming via `fetch()` works against OpenAI directly, but some
  OpenAI-compatible providers may not set CORS headers for browser calls —
  worth testing against at least OpenAI and OpenRouter early.
- Whether the scribble-erase heuristic needs tuning once tried by hand (it's
  new, unlike everything else here which is a direct port).
- Handwriting synthesis (decided: option A, port the pipeline): the Zhang-Suen
  thin + trace is the one non-trivial algorithm to port. Spike it early to
  confirm per-glyph cost is acceptable and that caching traced polylines per
  (char, size) keeps live replies smooth.
- Whether the large-"!" gesture (main near-vertical stroke ≥20% of canvas
  height + optional low dot) both fires reliably and avoids false positives
  against ordinary tall downstrokes or a deliberately large "I"/"1"; tune the
  straightness and aspect ratios by hand.
- Whether the dither-dissolve "drink"/"fade" effect is worth reproducing
  faithfully vs. an approximated grain/fade, and whether it reads well on a
  bright backlit screen rather than e-ink.
