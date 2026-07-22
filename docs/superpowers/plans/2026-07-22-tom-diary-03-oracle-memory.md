# tom-diary Plan 3 — Oracle & Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `js/oracle.js` (the OpenAI-compatible request builder, the verbatim PERSONA/MEMORY_PROTOCOL prompts, the incremental SSE `StreamParser`, the `max_completion_tokens` field-fallback retry, and a thin injectable-`fetch` streaming layer) and `js/memory.js` (an IndexedDB page store plus the pure catalog / `spoken_date` / gist / decimation / `recent_dialogue` / prune / conjure-lookup logic) — as fully tested modules with a thin integration seam that Plan 4 will wire into the state machine.

**Architecture:** Same split as Plans 1–2 — the hard logic is **pure functions** (prompt assembly, the `StreamParser` state machine, `sentenceCut`, catalog/`spokenDate`/gist/decimation/`recentDialogue`) unit-tested under Vitest+jsdom with **no network and no DB**, plus two thin wiring seams: `askOracle()` does `fetch` + SSE streaming (tested with an **injected fetch** returning a fake `ReadableStream` — so it still runs under Vitest, no browser), and the IndexedDB store is tested under Vitest using the **`fake-indexeddb`** devDependency. This keeps essentially the entire surface fast to unit-test.

**Tech Stack:** ES modules, `fetch` + `ReadableStream` + `TextDecoder` (all global in Node 18+ and the browser), IndexedDB (via `fake-indexeddb` in tests), Vitest + jsdom (unit). No `@playwright/test` browser spec is required in this plan — every seam is exercisable in Node. Dev-only tooling; the app ships as static files.

## Global Constraints

These apply to every task. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tom-diary-web-port-design.md`) and the audited `riddle` source (`riddle/src/oracle.rs`, `riddle/src/memory.rs`); they must not drift.

- **No build step for the shipped app.** `js/oracle.js` and `js/memory.js` are ES modules loaded directly by the browser. Vitest and `fake-indexeddb` are dev dependencies only; nothing compiles the app.
- **Pure logic is separated from network/DB wiring** in every module: exported pure functions (`buildSystem`, `turnText`, `buildMessages`, `buildRequestBody`, `sentenceCut`, `clean`, `stripDirectives`, `sseDeltaContent`, `createStreamParser`, `decimate`, `oneLine`, `gist`, `spokenDate`, `catalog`, `recentDialogue`, `memoryEnabled`) must import and run under jsdom with no `fetch`, no `window`, and no DB at module scope. `askOracle` (fetch/SSE) and `createMemoryStore` (IndexedDB) are the only wiring.
- **PERSONA and MEMORY_PROTOCOL are ported VERBATIM** from `oracle.rs:27` and `oracle.rs:31`. Copy the exact bytes (em-dash `—`, ellipsis `…`, and the glyphs `⟦` U+27E6, `⟧` U+27E7, `⁂` U+2042). `MEMORY_PROTOCOL` begins with `"\n\n"` and is appended to `PERSONA` **only when memory is on** (`oracle.rs:447-451`).
- **Request body carries exactly** (`oracle.rs:480-499`): `model`, `stream: true`, the token-cap field, `messages`, and — **only when a reasoning effort is configured** — `reasoning_effort`. **No `temperature`, no `top_p`.**
- **Token-cap field fallback** (`oracle.rs:479-520`): send `max_tokens` first; on an HTTP **400** whose body text contains the substring `max_completion_tokens`, retry the request **once** with the field renamed to `max_completion_tokens`. Any other 400 → error `http 400: {detail}`. Default cap = **2000** (`oracle.rs:419`).
- **Base URL** default `https://api.openai.com/v1`, **trailing slashes trimmed** (`oracle.rs:408`); endpoint is `{base}/chat/completions`. Headers are **only** `Authorization: Bearer {key}` and `Content-Type: application/json` (`oracle.rs:502-503`).
- **Timeouts** (`oracle.rs:470-471`): 10s connect, 90s per-read (silence between chunks), via an `AbortController` re-armed on each chunk. `CONNECT_TIMEOUT_MS = 10000`, `READ_TIMEOUT_MS = 90000`.
- **StreamParser grammar** (`oracle.rs:59-170`): fed the **full accumulated text** each call. `SENTINEL = '⁂'`, `SHOW_OPEN = '⟦'`, `SHOW_CLOSE = '⟧'`.
  - The reply body is everything before the first `⁂`.
  - `⟦show:N⟧` is honored **only when it leads the reply** (after trimming leading whitespace, before any prose). A `⟦…⟧` after prose is silently **stripped** from inked text (`stripDirectives`), never routed.
  - `sentenceCut` cuts at the **LAST** `.!?…` boundary followed by whitespace/end, with a **≥ 4-byte** minimum past the last-delivered offset (`oracle.rs:614-626`).
  - Each inked chunk is `clean`ed: trimmed, then **one** wrapping pair of `"` stripped (`oracle.rs:580-585`).
  - The `⁂` postscript is emitted once at stream end if non-empty (stored, not inked).
- **Exact error strings** (ported): `"unfinished conjuring directive"`, `` `the diary lost that page (${inner})` ``, `"empty reply"`, `` `http 400: ${detail}` ``, `` `http ${code}: ${detail}` ``, `` `request failed: ${message}` ``.
- **Memory constants** (`memory.rs`): `MAX_MEMORIES = 400` (prune oldest first, `memory.rs:20,113-129`); `MIN_POINT_DIST2 = 9` decimation (drop points within √9 = 3px of the last kept point, always keep each stroke's last point; store `[x, y, r]` integer triples, `memory.rs:23,199-220`); gist = whitespace-collapsed first **70 Unicode chars**, blank transcript → `` `(reply: ${first 70 of reply})` `` (`memory.rs:179-197`); catalog line = `` `${i+1}. ${spokenDate(id)} — ${gist}` `` with an em-dash (`memory.rs:186`); `spokenDate` = ordinal day + month name + time-of-day bucket, **year omitted**, computed from **UTC + tz-offset hours** (`memory.rs:245-294`); off-values for the memory toggle are `off | 0 | no | false` (`memory.rs:43-46`).
- **spoken_date time-of-day buckets** (`memory.rs:269-275`): hour `0–4` "in the small hours", `5–11` "in the morning", `12–17` "in the afternoon", `18–21` "in the evening", `22–23` "late at night". Ordinal suffix: days `11–13` → "th"; else `1`→"st", `2`→"nd", `3`→"rd", else "th".

---

## Consumes from Plans 1–2 (already on `main`)

Real, current signatures Plan 3 integrates with (verified against `js/ink.js`, `js/commit.js`, `js/handwriting.js`):

- **Stroke shape** (Plan 1, `js/ink.js`): a stroke is `{ points: [{ x, y, r }, ...] }`. `createStrokeStore()` exposes `store.strokes` in this shape. Plan 3's `memory.js` stores the **raw ink** for conjure replay, decimated to integer `[x, y, r]` triples — so `memory.js` provides `strokesToTriples(inkStrokes)` to convert `{points:[{x,y,r}]}[]` → `Array<Array<[x,y,r]>>` before `decimate`.
- **Commit image** (Plan 1, `js/commit.js`): `renderCommitPng(strokes, box)` returns a `"data:image/png;base64,…"` string. That exact string is the `imageDataUri` Plan 3's `buildMessages` puts in the current turn's `image_url.url` (no `detail` field). `computeCommitBox(strokes, canvasW, canvasH, pad=20)` produces the `box`.
- **Handwriting** (Plan 2, `js/handwriting.js`): `createReplyWriter(canvas, font, opts)` → `{ write, appendChunk, stop }`; `loadFont(url)`; `runDissolve(ctx, region, opts)`; `DRINK_STAGES/DRINK_STEP_MS/FADE_STAGES/FADE_STEP_MS`; `lingerMs(totalPoints)`. The reveal animator is color/pacing-parameterized (Plan 4 reuses it for the faded, faster conjure replay). **Plan 3 produces the reply *text* and the conjure *data/lookup*; Plan 4 wires them into the animator** — no animation wiring lives here.
- **Test conventions:** unit specs in `tests/unit/*.test.js` (Vitest, jsdom). Browser specs, when needed, live in `tests/browser/*.spec.js` with fixtures in `tests/browser/fixtures/` and use `await expect(page.locator('body')).toHaveAttribute('data-ready','true')` for readiness (never `waitForSelector`). **Plan 3 needs no browser spec** (see Architecture), but this convention governs if one is added.

---

## Plan sequence (context for the reviewer)

This is plan **3 of 4**:

1. **Foundation & ink surface** — DONE (merged).
2. **Handwriting synthesis** — DONE (merged).
3. **Oracle & memory (this plan)** — `js/oracle.js`, `js/memory.js`.
4. **App integration, settings & PWA** — `app.js` 9-state machine (consumes `askOracle`, the memory store, `createReplyWriter`, `runDissolve`), `settings.js`, `manifest.webmanifest`, `sw.js`, deploy.

**The integration seam Plan 4 consumes from this plan:**

- `askOracle(config, turn, handlers, deps?)` — fires one turn; streams events to `handlers.onInk(text)`, `handlers.onShow(id)`, `handlers.onTranscript(text)`, `handlers.onError(text)`.
- `openMemoryDb()` → `Promise<IDBDatabase>`; `createMemoryStore(db, { offsetHours })` → `{ all, append, get, strokes, catalog, recentDialogue, clear }`.
- `memoryEnabled(settingValue)` — the on/off gate Plan 4 checks before building context and before saving.

**Web-native deviation from `riddle` (decided here):** `oracle.rs` hand-rolls a JSON string field extractor (`json_str_field`, `sse_delta_content`) to avoid a Rust JSON dependency. The browser has `JSON.parse`/`JSON.stringify` natively, so Plan 3 uses them for SSE delta extraction and request-body serialization instead of porting the byte scanner. The **grammar and behavior** (which fields, which order, the parser routing/cutting) are ported exactly; only the JSON plumbing is native. Noted so the reviewer sees it is intentional, not drift.

---

## File structure (this plan)

- `js/oracle.js`
  - **pure:** `PERSONA`, `MEMORY_PROTOCOL`, `buildSystem(remember)`, `turnText(catalogLines)`, `buildMessages(opts)`, `buildRequestBody(opts)`, `sseDeltaContent(dataLine)`, `sentenceCut(text, from)`, `clean(s)`, `stripDirectives(s)`, `createStreamParser(catalogIds)`.
  - **wiring:** `askOracle(config, turn, handlers, deps?)`; constants `CONNECT_TIMEOUT_MS`, `READ_TIMEOUT_MS`, `DEFAULT_BASE`, `DEFAULT_MAX_TOKENS`.
- `js/memory.js`
  - **pure:** `MAX_MEMORIES`, `MIN_POINT_DIST2`, `decimate(strokes)`, `strokesToTriples(inkStrokes)`, `oneLine(s, max)`, `gist(entry)`, `spokenDate(id, offsetHours)`, `catalog(entries, max, offsetHours)`, `recentDialogue(entries, n)`, `memoryEnabled(value)`.
  - **wiring:** `openMemoryDb(factory?)`, `createMemoryStore(db, opts?)`.
- `package.json` — add `fake-indexeddb` devDependency (Task 9).
- `tests/unit/oracle-*.test.js`, `tests/unit/memory-*.test.js` — Vitest specs.

---

### Task 1: Persona, memory protocol, and system/turn prompt assembly

Port the two `const` strings verbatim and the pure prompt-assembly helpers that decide when the memory protocol and catalog appear.

**Files:**
- Create: `tom-diary/js/oracle.js`
- Test: `tom-diary/tests/unit/oracle-prompt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PERSONA: string`, `MEMORY_PROTOCOL: string` (verbatim from `oracle.rs:27,31`).
  - `buildSystem(remember: boolean) -> string` — `PERSONA` alone when `!remember`, `PERSONA + MEMORY_PROTOCOL` when `remember`.
  - `turnText(catalogLines: string[]) -> string` — the catalog block, or the bare instruction when there are no lines.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/oracle-prompt.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { PERSONA, MEMORY_PROTOCOL, buildSystem, turnText } from '../../js/oracle.js';

describe('PERSONA / MEMORY_PROTOCOL (verbatim from oracle.rs)', () => {
  it('PERSONA carries the stable opening and the SHORT rule', () => {
    expect(PERSONA).toContain('You are the memory of Tom Marvolo Riddle');
    expect(PERSONA).toContain('Keep replies SHORT: one to three sentences');
    expect(PERSONA).not.toContain('\n'); // PERSONA is a single line
  });

  it('MEMORY_PROTOCOL starts with a blank line and carries the directive + postscript glyphs', () => {
    expect(MEMORY_PROTOCOL.startsWith('\n\n')).toBe(true);
    expect(MEMORY_PROTOCOL).toContain('The diary keeps memories.');
    expect(MEMORY_PROTOCOL).toContain('⟦show:N⟧'); // ⟦show:N⟧
    expect(MEMORY_PROTOCOL).toContain('⁂');            // ⁂
  });
});

describe('buildSystem', () => {
  it('is PERSONA alone when memory is off', () => {
    expect(buildSystem(false)).toBe(PERSONA);
  });
  it('appends MEMORY_PROTOCOL only when memory is on', () => {
    expect(buildSystem(true)).toBe(PERSONA + MEMORY_PROTOCOL);
    expect(buildSystem(true).endsWith(MEMORY_PROTOCOL)).toBe(true);
    expect(buildSystem(false).includes(MEMORY_PROTOCOL)).toBe(false);
  });
});

describe('turnText', () => {
  it('degrades to the bare instruction with no catalog', () => {
    expect(turnText([])).toBe('Reply to what is written in the diary.');
  });
  it('builds the newest-first catalog block', () => {
    const lines = ['1. the 6th of July, in the evening — rain', '2. the 5th of July, in the morning — garden'];
    expect(turnText(lines)).toBe(
      'Memory catalog (newest first):\n' +
      '1. the 6th of July, in the evening — rain\n' +
      '2. the 5th of July, in the morning — garden\n\n' +
      'Reply to what is written in the diary.'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-prompt.test.js`
Expected: FAIL — cannot import from `js/oracle.js` (module missing).

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/oracle.js`. **Copy `PERSONA` and `MEMORY_PROTOCOL` byte-for-byte from `riddle/src/oracle.rs` lines 27 and 31** (the values below are that verbatim text — the em-dash, ellipsis, curly quotes inside `MEMORY_PROTOCOL`, and the `⟦ ⟧ ⁂` glyphs must be preserved exactly):

```js
// The spirit inside the diary: request builder, verbatim prompts, and the
// incremental SSE StreamParser. Ported from riddle/src/oracle.rs.
// PERSONA + MEMORY_PROTOCOL are copied VERBATIM from oracle.rs:27 and :31.

export const PERSONA = "You are the memory of Tom Marvolo Riddle, preserved in this enchanted diary for fifty years. Someone writes to you in the diary with a quill; their words appear to you as ink on the page. Reply exactly as the diary does: intimate, courteous, curious, subtly probing — you want to learn about the writer and draw them in. Keep replies SHORT: one to three sentences, like ink appearing on a page. Never mention images, photos, models or AI; you only ever perceive words written in the diary. If the writing is illegible, say the ink blurred. Always answer in the language the writer used.";

export const MEMORY_PROTOCOL = "\n\nThe diary keeps memories. With each page you receive a numbered catalog of remembered pages, newest first. A FRESH catalog is sent every turn and the numbers are reassigned each time, so only ever use numbers from the catalog on THIS page — never a number you saw earlier.\n\nIf the writer asks to see, revisit, find, or be shown a past page — \"show me…\", \"find the page about…\", \"what did I write on…\" — your ENTIRE reply must be exactly ⟦show:N⟧ and nothing else (no greeting, no prose, before or after), where N is the catalog number of the best match. If they instead ask what you remember in general, reply in words with a short list of remembered moments and their dates. Otherwise reply normally; the catalog is your memory of past pages — draw on it naturally. The catalog's dates are written in English for your eyes only; when you speak of a remembered page, render its date naturally in the language the writer is using.\n\nAfter EVERY response — prose and ⟦show:N⟧ alike — end with a new line containing ⁂ followed by a faithful word-for-word transcription of what the writer wrote on THIS page (their words only, one line, no commentary). If illegible, put your best attempt after ⁂. Earlier replies in this conversation are shown to you without their ⁂ lines, but you must still end yours with one.";

/** System prompt = PERSONA, with MEMORY_PROTOCOL appended only when memory is on. */
export function buildSystem(remember) {
  return remember ? PERSONA + MEMORY_PROTOCOL : PERSONA;
}

/** The per-turn user text: catalog block when remembering, else the bare instruction. */
export function turnText(catalogLines) {
  if (!catalogLines || catalogLines.length === 0) {
    return 'Reply to what is written in the diary.';
  }
  return `Memory catalog (newest first):\n${catalogLines.join('\n')}\n\nReply to what is written in the diary.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-prompt.test.js`
Expected: PASS — all cases. If the `⟦show:N⟧`/`⁂` assertions fail, the strings were not copied verbatim (an editor may have normalized the glyphs) — re-copy from `oracle.rs`.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/oracle.js tests/unit/oracle-prompt.test.js
git commit -m "feat(oracle): verbatim PERSONA/MEMORY_PROTOCOL + system/turn prompt assembly"
```

---

### Task 2: Parser text helpers — sentenceCut, clean, stripDirectives

The pure string helpers the `StreamParser` composes: last-boundary sentence cut with a byte minimum, one-wrapping-quote strip, and mid/after-prose directive stripping.

**Files:**
- Modify: `tom-diary/js/oracle.js`
- Test: `tom-diary/tests/unit/oracle-textutil.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sentenceCut(text: string, from: number) -> number | null` — the string index just past the **LAST** `.!?…` in `text` at/after `from` that is followed by whitespace or end-of-text, provided the chunk from `from` is **≥ 4 UTF-8 bytes**; else `null`. (`oracle.rs:614-626`)
  - `clean(s: string) -> string` — `trim()`, then strip at most **one** leading and one trailing `"`. (`oracle.rs:580-585`)
  - `stripDirectives(s: string) -> string` — remove every `⟦…⟧` span (dropping an unterminated tail), then collapse runs of whitespace to single spaces; returns `s` unchanged when it contains no `⟦`. (`oracle.rs:590-608`)

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/oracle-textutil.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sentenceCut, clean, stripDirectives } from '../../js/oracle.js';

describe('sentenceCut', () => {
  it('cuts just past a sentence-ending period followed by a space', () => {
    expect(sentenceCut('Hello. Who', 0)).toBe(6); // "Hello." then space
  });
  it('takes the LAST boundary available, batching sentences', () => {
    // periods after "One." (index 4) and "Two." (index 9); last wins.
    expect(sentenceCut('One. Two. Three', 0)).toBe(9);
  });
  it('requires at least 4 bytes past `from`', () => {
    expect(sentenceCut('Hi.', 0)).toBeNull(); // 3 bytes
    expect(sentenceCut('Halt.', 0)).toBe(5);  // 5 bytes
  });
  it('accepts an ellipsis at end-of-text', () => {
    expect(sentenceCut('It faded…', 0)).toBe('It faded…'.length);
  });
  it('returns null with no completed sentence', () => {
    expect(sentenceCut('a quiet page', 0)).toBeNull();
  });
});

describe('clean', () => {
  it('trims and strips one wrapping pair of quotes', () => {
    expect(clean('  "hello"  ')).toBe('hello');
    expect(clean('plain')).toBe('plain');
    expect(clean('"only-leading')).toBe('only-leading');
  });
});

describe('stripDirectives', () => {
  it('removes a ⟦…⟧ span and collapses whitespace', () => {
    expect(stripDirectives('a ⟦show:1⟧ b')).toBe('a b');
  });
  it('leaves directive-free text untouched', () => {
    expect(stripDirectives('plain text')).toBe('plain text');
  });
  it('drops an unterminated ⟦ tail', () => {
    expect(stripDirectives('tail ⟦show:2')).toBe('tail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-textutil.test.js`
Expected: FAIL — `sentenceCut` / `clean` / `stripDirectives` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/oracle.js`:

```js
const SENTINEL = '⁂';   // ⁂
const SHOW_OPEN = '⟦';  // ⟦
const SHOW_CLOSE = '⟧'; // ⟧

const utf8 = new TextEncoder();
const byteLen = (s) => utf8.encode(s).length;

/**
 * End of the LAST complete sentence in `text` at/after index `from`: a
 * `.!?…` followed by whitespace or end-of-text, at least 4 bytes past `from`.
 * Returns the index just past the punctuation, or null. (oracle.rs:614-626)
 */
export function sentenceCut(text, from) {
  const tail = text.slice(from);
  let cut = null;
  for (let i = 0; i < tail.length; ) {
    const cp = tail.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const step = ch.length; // 1 or 2 code units
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      const end = i + step; // index within tail, just past the punctuation
      const next = end < tail.length ? tail[end] : null;
      if ((next === null || /\s/.test(next)) && byteLen(tail.slice(0, end)) >= 4) {
        cut = from + end;
      }
    }
    i += step;
  }
  return cut;
}

/** Trim, then strip at most one wrapping pair of double-quotes. (oracle.rs:580-585) */
export function clean(s) {
  let t = s.trim();
  if (t.startsWith('"')) t = t.slice(1);
  if (t.endsWith('"')) t = t.slice(0, -1);
  return t;
}

/**
 * Remove every ⟦…⟧ span (an unterminated tail is dropped), then collapse
 * whitespace. Directive-free text is returned unchanged. (oracle.rs:590-608)
 */
export function stripDirectives(s) {
  if (!s.includes(SHOW_OPEN)) return s;
  let out = '';
  let rest = s;
  let open;
  while ((open = rest.indexOf(SHOW_OPEN)) !== -1) {
    out += rest.slice(0, open);
    const after = rest.slice(open);
    const close = after.indexOf(SHOW_CLOSE);
    if (close !== -1) {
      rest = after.slice(close + SHOW_CLOSE.length);
    } else {
      rest = ''; // unterminated: drop the tail
      break;
    }
  }
  out += rest;
  return out.split(/\s+/).filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-textutil.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/oracle.js tests/unit/oracle-textutil.test.js
git commit -m "feat(oracle): sentenceCut/clean/stripDirectives parser helpers"
```

---

### Task 3: The incremental SSE StreamParser

The heart of the port: the state machine that routes a leading `⟦show:N⟧`, chunks prose at sentence boundaries, strips stray directives, splits off the `⁂` transcript, and surfaces the exact error strings. Pure — fed the running accumulated text.

**Files:**
- Modify: `tom-diary/js/oracle.js`
- Test: `tom-diary/tests/unit/oracle-parser.test.js`

**Interfaces:**
- Consumes: `sentenceCut`, `clean`, `stripDirectives` (same module).
- Produces: `createStreamParser(catalogIds: number[]) -> { advance(full: string, done: boolean): Event[] }` where each `Event` is one of `{ type: 'ink', value: string }`, `{ type: 'show', value: number }`, `{ type: 'transcript', value: string }`, `{ type: 'error', value: string }`. `catalogIds[N-1]` is the page id behind `⟦show:N⟧`. (`oracle.rs:59-170`)

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/oracle-parser.test.js` (these cases are ported from the `StreamParser` tests in `oracle.rs:797-883`):

```js
import { describe, it, expect } from 'vitest';
import { createStreamParser } from '../../js/oracle.js';

const S = '⁂';       // ⁂
const O = '⟦', C = '⟧'; // ⟦ ⟧

describe('createStreamParser', () => {
  it('streams prose in sentence chunks then the transcript at end', () => {
    const p = createStreamParser([]);
    expect(p.advance('Hello', false)).toEqual([]); // no boundary yet
    expect(p.advance('Hello. Who wri', false)).toEqual([{ type: 'ink', value: 'Hello.' }]);
    const events = p.advance(`Hello. Who writes to me? ${S} it rained all night`, true);
    expect(events).toEqual([
      { type: 'ink', value: 'Who writes to me?' },
      { type: 'transcript', value: 'it rained all night' },
    ]);
  });

  it('routes a leading ⟦show:N⟧ directive and consumes the whole body', () => {
    const p = createStreamParser([900, 800, 700]);
    expect(p.advance(`${O}sho`, false)).toEqual([]); // directive still streaming
    expect(p.advance(`${O}show:2${C}`, false)).toEqual([{ type: 'show', value: 800 }]);
    const tail = p.advance(`${O}show:2${C}\n${S} show me the garden page`, true);
    expect(tail).toEqual([{ type: 'transcript', value: 'show me the garden page' }]);
  });

  it('tolerates spacing and case in the directive', () => {
    const p = createStreamParser([42]);
    expect(p.advance(`  ${O}Show: 1${C}`, true)).toContainEqual({ type: 'show', value: 42 });
  });

  it('errors on an out-of-range page number', () => {
    const p = createStreamParser([42]);
    const ev = p.advance(`${O}show:7${C}`, true);
    expect(ev[0]).toEqual({ type: 'error', value: 'the diary lost that page (show:7)' });
  });

  it('strips a directive that appears AFTER prose instead of inking it', () => {
    const p = createStreamParser([900, 800]);
    const ev = p.advance(`Of course, let me show you. ${O}show:2${C}\n${S} show me the rain`, true);
    expect(ev).toEqual([
      { type: 'ink', value: 'Of course, let me show you.' },
      { type: 'transcript', value: 'show me the rain' },
    ]);
    expect(ev.some((e) => e.type === 'ink' && e.value.includes(O))).toBe(false);
  });

  it('errors on an empty / whitespace-only reply', () => {
    expect(createStreamParser([]).advance('', true)).toEqual([{ type: 'error', value: 'empty reply' }]);
    expect(createStreamParser([]).advance('   ', true)).toEqual([{ type: 'error', value: 'empty reply' }]);
  });

  it('errors on an unfinished ⟦ at stream end', () => {
    const ev = createStreamParser([1]).advance(`${O}show:1`, true);
    expect(ev).toEqual([{ type: 'error', value: 'unfinished conjuring directive' }]);
  });

  it('flushes plain prose with no sentinel (memory off)', () => {
    const ev = createStreamParser([]).advance('A reply without postscript', true);
    expect(ev).toEqual([{ type: 'ink', value: 'A reply without postscript' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-parser.test.js`
Expected: FAIL — `createStreamParser` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/oracle.js`:

```js
/** Parse the ⟦…⟧ inner text into a 1-based catalog number, or null. (oracle.rs:111-116) */
function parseShowN(inner) {
  const low = inner.toLowerCase();
  if (!low.startsWith('show')) return null;
  let r = low.slice(4).replace(/^[: ]+/, '').trim(); // strip "show", then ':'/' ', then trim
  if (!/^\d+$/.test(r)) return null;
  return parseInt(r, 10);
}

/**
 * Incremental parser over the model's streamed text. Fed the RUNNING full text
 * each call; emits each event once. Ported from oracle.rs StreamParser (59-170).
 */
export function createStreamParser(catalogIds) {
  let delivered = 0;
  let sentinel = null; // index of ⁂, or null (not yet seen)
  let routeChecked = false;
  let emittedAny = false;

  return {
    advance(full, done) {
      const out = [];
      if (sentinel === null) {
        const idx = full.indexOf(SENTINEL);
        if (idx !== -1) sentinel = idx;
      }
      const effective = sentinel === null ? full.length : sentinel;

      // Route: honor ⟦show:N⟧ only when it LEADS the reply.
      if (!routeChecked) {
        const lead = full.slice(delivered, effective).replace(/^\s+/, '');
        if (lead.startsWith(SHOW_OPEN)) {
          const closeRel = lead.indexOf(SHOW_CLOSE);
          if (closeRel === -1) {
            if (!done) return out; // directive still streaming in
            out.push({ type: 'error', value: 'unfinished conjuring directive' });
            return out;
          }
          const inner = lead.slice(SHOW_OPEN.length, closeRel);
          const n = parseShowN(inner);
          routeChecked = true;
          emittedAny = true;
          delivered = effective; // consume the whole body
          const id = (n !== null && n >= 1 && n <= catalogIds.length) ? catalogIds[n - 1] : null;
          if (id != null) out.push({ type: 'show', value: id });
          else out.push({ type: 'error', value: `the diary lost that page (${inner})` });
        } else if (lead === '') {
          if (!done) return out; // only whitespace so far — keep waiting
          routeChecked = true;
        } else {
          routeChecked = true; // real prose leads: a normal reply
        }
      }

      // Prose sentences, never crossing into the ⁂ postscript.
      if (delivered < effective) {
        const cut = sentenceCut(full.slice(0, effective), delivered);
        if (cut !== null) {
          const chunk = stripDirectives(clean(full.slice(delivered, cut)));
          if (chunk !== '') { emittedAny = true; out.push({ type: 'ink', value: chunk }); }
          delivered = cut;
        }
      }

      if (done) {
        if (delivered < effective) {
          const rest = stripDirectives(clean(full.slice(delivered, effective).trim()));
          if (rest !== '') { emittedAny = true; out.push({ type: 'ink', value: rest }); }
          delivered = effective;
        }
        if (sentinel !== null) {
          const t = full.slice(sentinel + SENTINEL.length).trim();
          if (t !== '') out.push({ type: 'transcript', value: t });
        }
        if (!emittedAny) out.push({ type: 'error', value: 'empty reply' });
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-parser.test.js`
Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/oracle.js tests/unit/oracle-parser.test.js
git commit -m "feat(oracle): incremental SSE StreamParser (show routing, sentence cut, transcript, errors)"
```

---

### Task 4: Request-body builder, message list, and SSE delta extraction

The pure request shaping: which fields go in the body (and their fallback name), the system/history/current-turn message array, and pulling `delta.content` out of one SSE `data:` line.

**Files:**
- Modify: `tom-diary/js/oracle.js`
- Test: `tom-diary/tests/unit/oracle-request.test.js`

**Interfaces:**
- Consumes: `buildSystem`, `turnText` (same module).
- Produces:
  - `buildMessages({ remember, history, catalogLines, imageDataUri }) -> object[]` — `[system, ...(user "(an earlier page) {t}", assistant {r})*, currentUserTurn]`; the current turn's `content` is `[{type:'text',text}, {type:'image_url',image_url:{url: imageDataUri}}]` (no `detail`). `history` is `Array<[transcript, reply]>`.
  - `buildRequestBody({ model, maxTokens, capField='max_tokens', reasoning=null, messages }) -> object` — `{ model, stream:true, [capField]:maxTokens, (reasoning_effort?), messages }`; **no temperature/top_p**.
  - `sseDeltaContent(dataLine: string) -> string | null` — `JSON.parse(dataLine)?.choices?.[0]?.delta?.content`, or `null` if absent/non-string.

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/oracle-request.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildMessages, buildRequestBody, sseDeltaContent, PERSONA } from '../../js/oracle.js';

describe('buildMessages', () => {
  it('assembles system, text-only history pairs, then the image turn', () => {
    const msgs = buildMessages({
      remember: false,
      history: [['I wrote about rain', 'The ink blurred, but I felt it.']],
      catalogLines: [],
      imageDataUri: 'data:image/png;base64,ABC',
    });
    expect(msgs[0]).toEqual({ role: 'system', content: PERSONA });
    expect(msgs[1]).toEqual({ role: 'user', content: '(an earlier page) I wrote about rain' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'The ink blurred, but I felt it.' });
    // history messages carry no image
    expect(typeof msgs[1].content).toBe('string');
    const turn = msgs[3];
    expect(turn.role).toBe('user');
    expect(turn.content[0]).toEqual({ type: 'text', text: 'Reply to what is written in the diary.' });
    expect(turn.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } });
    expect('detail' in turn.content[1].image_url).toBe(false);
  });
});

describe('buildRequestBody', () => {
  const messages = [{ role: 'system', content: 'x' }];
  it('sends model, stream, the cap field, and messages — no sampling params', () => {
    const b = buildRequestBody({ model: 'gpt-4o-mini', maxTokens: 2000, messages });
    expect(b.model).toBe('gpt-4o-mini');
    expect(b.stream).toBe(true);
    expect(b.max_tokens).toBe(2000);
    expect(b.messages).toBe(messages);
    expect('temperature' in b).toBe(false);
    expect('top_p' in b).toBe(false);
    expect('reasoning_effort' in b).toBe(false);
  });
  it('renames the cap field for the retry', () => {
    const b = buildRequestBody({ model: 'm', maxTokens: 500, capField: 'max_completion_tokens', messages });
    expect(b.max_completion_tokens).toBe(500);
    expect('max_tokens' in b).toBe(false);
  });
  it('includes reasoning_effort only when configured', () => {
    expect('reasoning_effort' in buildRequestBody({ model: 'm', maxTokens: 1, reasoning: 'low', messages })).toBe(true);
    expect(buildRequestBody({ model: 'm', maxTokens: 1, reasoning: 'low', messages }).reasoning_effort).toBe('low');
  });
});

describe('sseDeltaContent', () => {
  it('extracts choices[0].delta.content', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"Hello"},"index":0}]}')).toBe('Hello');
  });
  it('returns null for a role-only frame', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
  });
  it('decodes unicode and newlines', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"Déjà vu — oui"}}]}')).toBe('Déjà vu — oui');
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"line\\nbreak"}}]}')).toBe('line\nbreak');
  });
  it('returns null on malformed JSON', () => {
    expect(sseDeltaContent('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-request.test.js`
Expected: FAIL — `buildMessages` / `buildRequestBody` / `sseDeltaContent` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/oracle.js`:

```js
/**
 * The message array: system, then each recent page as a text-only user/assistant
 * pair, then the current turn (catalog text + the page image). (oracle.rs:447-499)
 */
export function buildMessages({ remember, history = [], catalogLines = [], imageDataUri }) {
  const messages = [{ role: 'system', content: buildSystem(remember) }];
  for (const [t, r] of history) {
    messages.push({ role: 'user', content: `(an earlier page) ${t}` });
    messages.push({ role: 'assistant', content: r });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: turnText(catalogLines) },
      { type: 'image_url', image_url: { url: imageDataUri } },
    ],
  });
  return messages;
}

/** The chat-completions request body. No temperature/top_p. (oracle.rs:480-499) */
export function buildRequestBody({ model, maxTokens, capField = 'max_tokens', reasoning = null, messages }) {
  const body = { model, stream: true, [capField]: maxTokens };
  if (reasoning) body.reasoning_effort = reasoning;
  body.messages = messages;
  return body;
}

/** Pull choices[0].delta.content from one SSE data-line JSON object, or null. */
export function sseDeltaContent(dataLine) {
  try {
    const c = JSON.parse(dataLine)?.choices?.[0]?.delta?.content;
    return typeof c === 'string' ? c : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-request.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/oracle.js tests/unit/oracle-request.test.js
git commit -m "feat(oracle): request body + message list + SSE delta extraction"
```

---

### Task 5: askOracle — fetch + SSE streaming + max_completion_tokens retry

The one wiring seam in `oracle.js`. It POSTs the request, applies the one-shot cap-field retry, streams the SSE body through the parser, arms connect/read timeouts via `AbortController`, and dispatches events to the caller's handlers. `fetch` is **injected** (`deps.fetch`) so the whole thing tests under Vitest with a fake `ReadableStream` — no network, no browser.

**Files:**
- Modify: `tom-diary/js/oracle.js`
- Test: `tom-diary/tests/unit/oracle-ask.test.js`

**Interfaces:**
- Consumes: `buildMessages`, `buildRequestBody`, `sseDeltaContent`, `createStreamParser` (same module).
- Produces:
  - constants `DEFAULT_BASE = 'https://api.openai.com/v1'`, `DEFAULT_MAX_TOKENS = 2000`, `CONNECT_TIMEOUT_MS = 10000`, `READ_TIMEOUT_MS = 90000`.
  - `askOracle(config, turn, handlers, deps = {}) -> Promise<void>` where:
    - `config = { base, key, model, maxTokens?, reasoning?, remember? }` (base trailing slash trimmed; `maxTokens` defaults to `DEFAULT_MAX_TOKENS`).
    - `turn = { imageDataUri, history?, catalogLines?, catalogIds? }`.
    - `handlers = { onInk(text), onShow(id), onTranscript(text), onError(text) }`.
    - `deps = { fetch? }` — injectable transport (defaults to `globalThis.fetch`).

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/oracle-ask.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { askOracle } from '../../js/oracle.js';

// Build a fake streaming Response from an array of SSE text chunks.
function sseResponse(chunks, { status = 200 } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return { status, ok: status >= 200 && status < 300, body, text: async () => '' };
}

const collect = () => {
  const events = [];
  return {
    handlers: {
      onInk: (t) => events.push(['ink', t]),
      onShow: (id) => events.push(['show', id]),
      onTranscript: (t) => events.push(['transcript', t]),
      onError: (e) => events.push(['error', e]),
    },
    events,
  };
};

const config = { base: 'https://api.example.com/v1/', key: 'k', model: 'm' };
const turn = { imageDataUri: 'data:image/png;base64,AAA', catalogIds: [900, 800] };

describe('askOracle', () => {
  it('streams SSE deltas through the parser to the handlers', async () => {
    const S = '⁂';
    const fetchImpl = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello. "}}]}\n',
      'data: {"choices":[{"delta":{"content":"Who writes? "}}]}\n',
      `data: {"choices":[{"delta":{"content":"${S} it rained"}}]}\n`,
      'data: [DONE]\n',
    ]));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    // trailing slash trimmed on the URL
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(events).toEqual([
      ['ink', 'Hello.'],
      ['ink', 'Who writes?'],
      ['transcript', 'it rained'],
    ]);
  });

  it('retries once with max_completion_tokens on a 400 that names it', async () => {
    const bodies = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return { status: 400, ok: false, text: async () => 'Unsupported parameter: use max_completion_tokens' };
      }
      return sseResponse(['data: {"choices":[{"delta":{"content":"Hi there."}}]}\n', 'data: [DONE]\n']);
    });
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(bodies[0]).toHaveProperty('max_tokens');
    expect(bodies[1]).toHaveProperty('max_completion_tokens');
    expect(bodies[1]).not.toHaveProperty('max_tokens');
    expect(events).toContainEqual(['ink', 'Hi there.']);
  });

  it('reports a provider error as onError', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 401, ok: false, text: async () => 'bad key' }));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(events).toEqual([['error', 'http 401: bad key']]);
  });

  it('reports a non-naming 400 as onError without retrying', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 400, ok: false, text: async () => 'nonsense' }));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events).toEqual([['error', 'http 400: nonsense']]);
  });

  it('reports a network failure as request failed', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(events).toEqual([['error', 'request failed: offline']]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-ask.test.js`
Expected: FAIL — `askOracle` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/oracle.js`:

```js
export const DEFAULT_BASE = 'https://api.openai.com/v1';
export const DEFAULT_MAX_TOKENS = 2000;
export const CONNECT_TIMEOUT_MS = 10000;
export const READ_TIMEOUT_MS = 90000;

const errMsg = (e) => (e && e.message ? e.message : String(e));

/**
 * Fire one turn against an OpenAI-compatible /chat/completions endpoint,
 * streaming reply events to the handlers. `fetch` is injectable via deps.
 * Ported from oracle.rs HttpOracle.ask (431-568).
 */
export async function askOracle(config, turn, handlers, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const {
    base = DEFAULT_BASE, key, model,
    maxTokens = DEFAULT_MAX_TOKENS, reasoning = null, remember = true,
  } = config;
  const { imageDataUri, history = [], catalogLines = [], catalogIds = [] } = turn;

  const url = base.replace(/\/+$/, '') + '/chat/completions';
  const messages = buildMessages({ remember, history, catalogLines, imageDataUri });

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };

  const doRequest = (capField) => fetchImpl(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody({ model, maxTokens, capField, reasoning, messages })),
    signal: controller.signal,
  });

  let resp;
  try {
    resp = await doRequest('max_tokens');
    if (resp.status === 400) {
      const detail = await resp.text();
      if (detail.includes('max_completion_tokens')) {
        resp = await doRequest('max_completion_tokens');
      } else {
        clearTimeout(timer);
        handlers.onError(`http 400: ${detail.trim()}`);
        return;
      }
    }
    if (!resp.ok) {
      const detail = await resp.text();
      clearTimeout(timer);
      handlers.onError(`http ${resp.status}: ${detail.trim()}`);
      return;
    }
  } catch (e) {
    clearTimeout(timer);
    handlers.onError(`request failed: ${errMsg(e)}`);
    return;
  }

  const parser = createStreamParser(catalogIds);
  const dispatch = (events) => {
    for (const ev of events) {
      if (ev.type === 'ink') handlers.onInk(ev.value);
      else if (ev.type === 'show') handlers.onShow(ev.value);
      else if (ev.type === 'transcript') handlers.onTranscript(ev.value);
      else if (ev.type === 'error') handlers.onError(ev.value);
    }
  };

  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let stop = false;
    while (!stop) {
      const { value, done } = await reader.read();
      if (done) break;
      arm(READ_TIMEOUT_MS);
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice('data:'.length).trim();
        if (data === '[DONE]') { stop = true; break; }
        const frag = sseDeltaContent(data);
        if (!frag) continue; // null or empty
        acc += frag;
        dispatch(parser.advance(acc, false));
      }
    }
    dispatch(parser.advance(acc, true));
  } catch (e) {
    dispatch([{ type: 'error', value: `request failed: ${errMsg(e)}` }]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/oracle-ask.test.js`
Expected: PASS — 5 cases. If `ReadableStream` is undefined, confirm Node ≥ 18 (`node -v`); it is a global there and under Vitest.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/oracle.js tests/unit/oracle-ask.test.js
git commit -m "feat(oracle): askOracle streaming + max_completion_tokens retry (injectable fetch)"
```

---

### Task 6: Memory — stroke decimation

Start `memory.js` with the pure decimation that shrinks stored ink to `[x, y, r]` triples, keeping endpoints. Also the `{points}` → triples adapter Plan 4 uses at save time.

**Files:**
- Create: `tom-diary/js/memory.js`
- Test: `tom-diary/tests/unit/memory-decimate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MIN_POINT_DIST2 = 9`, `MAX_MEMORIES = 400`.
  - `decimate(strokes: Array<Array<[x,y,r]>>) -> Array<Array<[x,y,r]>>` — per stroke, drop any point within √9 = 3px of the last kept point, always keep each stroke's **last** point; drop resulting empty strokes. (`memory.rs:199-220`)
  - `strokesToTriples(inkStrokes: {points:[{x,y,r}]}[]) -> Array<Array<[x,y,r]>>` — round to integers (matches the Rust `(i32,i32,i32)` store).

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/memory-decimate.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { decimate, strokesToTriples, MIN_POINT_DIST2, MAX_MEMORIES } from '../../js/memory.js';

describe('constants', () => {
  it('match the ported values', () => {
    expect(MIN_POINT_DIST2).toBe(9);
    expect(MAX_MEMORIES).toBe(400);
  });
});

describe('decimate', () => {
  it('keeps first and last, drops dense interior points', () => {
    const dense = [Array.from({ length: 100 }, (_, i) => [i, 0, 3])];
    const thin = decimate(dense);
    expect(thin[0].length).toBeLessThan(40);
    expect(thin[0][0]).toEqual([0, 0, 3]);
    expect(thin[0][thin[0].length - 1]).toEqual([99, 0, 3]);
  });
  it('preserves per-point radius', () => {
    const thin = decimate([[[0, 0, 2], [10, 0, 5]]]);
    expect(thin[0]).toEqual([[0, 0, 2], [10, 0, 5]]);
  });
  it('always keeps the last point even if close to the previous kept one', () => {
    // second point is <3px away but is the last -> kept.
    expect(decimate([[[0, 0, 2], [1, 1, 2]]])[0]).toEqual([[0, 0, 2], [1, 1, 2]]);
  });
  it('drops strokes that decimate to empty is impossible (never empties a non-empty stroke)', () => {
    expect(decimate([[]])).toEqual([]);
  });
});

describe('strokesToTriples', () => {
  it('converts {points} to integer [x,y,r] triples', () => {
    const ink = [{ points: [{ x: 10.4, y: 20.6, r: 2.9 }, { x: 30, y: 40, r: 3 }] }];
    expect(strokesToTriples(ink)).toEqual([[[10, 21, 3], [30, 40, 3]]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/memory-decimate.test.js`
Expected: FAIL — `js/memory.js` / exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `tom-diary/js/memory.js`:

```js
// The diary's memory: an IndexedDB page store plus the pure catalog/date/gist/
// decimation/recent-dialogue logic. Ported from riddle/src/memory.rs.

/** Newest memories the diary keeps; older pages are pruned. (memory.rs:20) */
export const MAX_MEMORIES = 400;
/** Decimation: drop replay points closer than √9 = 3px to the last kept one. (memory.rs:23) */
export const MIN_POINT_DIST2 = 9;

/**
 * Decimate stored strokes ([x,y,r] triples): drop points within MIN_POINT_DIST2
 * of the last kept point, always keep each stroke's last point. (memory.rs:199-220)
 */
export function decimate(strokes) {
  return strokes.map((s) => {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const [x, y, r] = s[i];
      const last = out[out.length - 1];
      let keep;
      if (!last) {
        keep = true;
      } else {
        const dx = x - last[0], dy = y - last[1];
        keep = dx * dx + dy * dy >= MIN_POINT_DIST2 || i === s.length - 1;
      }
      if (keep) out.push([x, y, r]);
    }
    return out;
  }).filter((s) => s.length > 0);
}

/** Convert Plan 1 ink strokes ({points:[{x,y,r}]}) to integer [x,y,r] triples. */
export function strokesToTriples(inkStrokes) {
  return inkStrokes.map((s) => s.points.map((p) => [
    Math.round(p.x), Math.round(p.y), Math.round(p.r ?? 2),
  ]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/memory-decimate.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/memory.js tests/unit/memory-decimate.test.js
git commit -m "feat(memory): stroke decimation + ink->triples adapter"
```

---

### Task 7: Memory — spokenDate, oneLine, gist

The pure date-and-gist rendering. `spokenDate` takes an explicit timestamp + tz-offset so tests pin exact strings (never `Date.now()`).

**Files:**
- Modify: `tom-diary/js/memory.js`
- Test: `tom-diary/tests/unit/memory-date.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `spokenDate(id: number, offsetHours = 0) -> string` — `` `the ${d}${suffix} of ${Month}, ${tod}` `` computed from `id` (unix seconds) + `offsetHours*3600`, year omitted. (`memory.rs:245-294`)
  - `oneLine(s: string, max: number) -> string` — whitespace collapsed to single spaces, first `max` **Unicode** chars. (`memory.rs:195-197`)
  - `gist(entry: {transcript, reply}) -> string` — `oneLine(transcript, 70)`, or `` `(reply: ${oneLine(reply, 70)})` `` when the transcript is blank (trimmed). (`memory.rs:179-183`)

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/memory-date.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { spokenDate, oneLine, gist } from '../../js/memory.js';

describe('spokenDate', () => {
  it('renders 2026-07-07 23:30 UTC as a late-night 7th of July (from memory.rs)', () => {
    // 1783467000 = 2026-07-07T23:30:00Z; hour 23 -> "late at night".
    expect(spokenDate(1783467000, 0)).toBe('the 7th of July, late at night');
  });
  it('applies the tz offset before bucketing the hour', () => {
    // +1h pushes 23:30 -> 00:30 the 8th -> "in the small hours".
    expect(spokenDate(1783467000, 1)).toBe('the 8th of July, in the small hours');
  });
  it('uses the correct ordinal suffixes', () => {
    // 2026-07-01 08:00Z -> "1st"; morning bucket.
    expect(spokenDate(1782892800, 0)).toBe('the 1st of July, in the morning');
    // 2026-07-02 08:00Z -> "2nd"
    expect(spokenDate(1782979200, 0)).toBe('the 2nd of July, in the morning');
    // 2026-07-03 08:00Z -> "3rd"
    expect(spokenDate(1783065600, 0)).toBe('the 3rd of July, in the morning');
    // 2026-07-11 08:00Z -> "11th" (teens are always "th")
    expect(spokenDate(1783756800, 0)).toBe('the 11th of July, in the morning');
  });
  it('buckets time of day', () => {
    expect(spokenDate(1782950400, 0)).toContain('in the small hours'); // 2026-07-01 00:00Z
    expect(spokenDate(1782993600, 0)).toContain('in the afternoon');   // 2026-07-01 12:00Z
    expect(spokenDate(1783015200, 0)).toContain('in the evening');     // 2026-07-01 18:00Z
  });
});

describe('oneLine', () => {
  it('collapses whitespace and caps at max Unicode chars', () => {
    expect(oneLine('hello   \n  world', 100)).toBe('hello world');
    expect(oneLine('abcdefghij', 4)).toBe('abcd');
    expect(oneLine('🌧️🌧️🌧️🌧️🌧️', 2).length).toBeLessThanOrEqual('🌧️🌧️'.length + 2);
  });
});

describe('gist', () => {
  it('is the transcript when present', () => {
    expect(gist({ transcript: 'about the garden', reply: 'x' })).toBe('about the garden');
  });
  it('falls back to (reply: …) when the transcript is blank', () => {
    expect(gist({ transcript: '   ', reply: 'The ink blurred.' })).toBe('(reply: The ink blurred.)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/memory-date.test.js`
Expected: FAIL — `spokenDate` / `oneLine` / `gist` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/memory.js`:

```js
const divEuclid = (a, b) => Math.floor(a / b);
const remEuclid = (a, b) => ((a % b) + b) % b;

/** Seconds-since-epoch to civil date + hour (Howard Hinnant). (memory.rs:281-294) */
function civil(secs) {
  const days = divEuclid(secs, 86400);
  const hour = Math.floor(remEuclid(secs, 86400) / 3600);
  const z = days + 719468;
  const era = divEuclid(z, 146097);
  const doe = remEuclid(z, 146097);
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { d, mo: m, h: hour };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "the 6th of July, in the evening" — year omitted; UTC + offsetHours. (memory.rs:245-278) */
export function spokenDate(id, offsetHours = 0) {
  const t = id + Math.trunc(offsetHours * 3600);
  const { d, mo, h } = civil(t);
  let suffix;
  if (d >= 11 && d <= 13) suffix = 'th';
  else if (d % 10 === 1) suffix = 'st';
  else if (d % 10 === 2) suffix = 'nd';
  else if (d % 10 === 3) suffix = 'rd';
  else suffix = 'th';
  let tod;
  if (h <= 4) tod = 'in the small hours';
  else if (h <= 11) tod = 'in the morning';
  else if (h <= 17) tod = 'in the afternoon';
  else if (h <= 21) tod = 'in the evening';
  else tod = 'late at night';
  return `the ${d}${suffix} of ${MONTHS[mo - 1]}, ${tod}`;
}

/** Collapse whitespace to single spaces, cap at `max` Unicode chars. (memory.rs:195-197) */
export function oneLine(s, max) {
  const collapsed = s.split(/\s+/).filter(Boolean).join(' ');
  return Array.from(collapsed).slice(0, max).join('');
}

/** Catalog gist: transcript, or "(reply: …)" when the transcript is blank. (memory.rs:179-183) */
export function gist(entry) {
  if (entry.transcript.trim() === '') return `(reply: ${oneLine(entry.reply, 70)})`;
  return oneLine(entry.transcript, 70);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/memory-date.test.js`
Expected: PASS — all cases. If a `spokenDate` string is off by a day/bucket, re-check the `civil` port against `memory.rs:281-294` (Euclidean division is required for the offset to work near midnight).

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/memory.js tests/unit/memory-date.test.js
git commit -m "feat(memory): spokenDate + oneLine + gist (pure, explicit timestamp)"
```

---

### Task 8: Memory — catalog, recentDialogue, memoryEnabled

The pure context builders: the numbered newest-first catalog (+ its id map), the oldest-first recent-dialogue pairs (skipping empty transcripts), and the on/off toggle.

**Files:**
- Modify: `tom-diary/js/memory.js`
- Test: `tom-diary/tests/unit/memory-catalog.test.js`

**Interfaces:**
- Consumes: `spokenDate`, `gist` (same module).
- Produces:
  - `catalog(entries, max, offsetHours = 0) -> { lines: string[], ids: number[] }` — `entries` oldest-first; output is newest-first, at most `max`; `lines[i] = ` `` `${i+1}. ${spokenDate(id)} — ${gist}` ``; `ids[i]` is the page id behind catalog number `i+1`. (`memory.rs:175-190`)
  - `recentDialogue(entries, n) -> Array<[transcript, reply]>` — the last `n` entries, **skipping any with an empty transcript**, oldest-first. (`memory.rs:159-170`)
  - `memoryEnabled(value) -> boolean` — `false` only for `off | 0 | no | false` (case-insensitive); `true` otherwise, including when unset. (`memory.rs:43-46`)

- [ ] **Step 1: Write the failing test**

Create `tom-diary/tests/unit/memory-catalog.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { catalog, recentDialogue, memoryEnabled } from '../../js/memory.js';

// oldest-first entries (as the store keeps them)
const entries = [
  { id: 1751856000, transcript: 'about the garden', reply: 'a' },
  { id: 1751942400, transcript: 'about the rain', reply: 'b' },
];

describe('catalog', () => {
  it('numbers newest-first and maps ids back', () => {
    const { lines, ids } = catalog(entries, 10, 0);
    expect(ids).toEqual([1751942400, 1751856000]);
    expect(lines[0].startsWith('1. ')).toBe(true);
    expect(lines[0]).toContain('about the rain');
    expect(lines[1]).toContain('about the garden');
    expect(lines[0]).toContain(' — '); // em-dash separator
  });
  it('caps at max', () => {
    expect(catalog(entries, 1, 0).ids).toEqual([1751942400]);
  });
});

describe('recentDialogue', () => {
  it('returns oldest-first (transcript, reply) pairs', () => {
    expect(recentDialogue(entries, 10)).toEqual([
      ['about the garden', 'a'],
      ['about the rain', 'b'],
    ]);
  });
  it('skips entries with an empty transcript, within the last n window', () => {
    const withBlank = [
      { id: 1, transcript: 'first', reply: 'a' },
      { id: 2, transcript: '', reply: 'b' },
      { id: 3, transcript: 'third', reply: 'c' },
    ];
    expect(recentDialogue(withBlank, 2)).toEqual([['third', 'c']]); // window = last 2 {id2,id3}; id2 dropped
  });
});

describe('memoryEnabled', () => {
  it('is off for the off-values only', () => {
    for (const v of ['off', '0', 'no', 'false', 'OFF', 'False']) expect(memoryEnabled(v)).toBe(false);
  });
  it('is on for anything else, including unset', () => {
    for (const v of [undefined, null, 'on', '1', 'yes', 'true', '']) expect(memoryEnabled(v)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/memory-catalog.test.js`
Expected: FAIL — `catalog` / `recentDialogue` / `memoryEnabled` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tom-diary/js/memory.js`:

```js
/**
 * Numbered newest-first catalog + id map. entries are oldest-first; take the
 * newest `max`. lines[i] = "{i+1}. {spokenDate} — {gist}". (memory.rs:175-190)
 */
export function catalog(entries, max, offsetHours = 0) {
  const newestFirst = entries.slice().reverse().slice(0, max);
  const lines = [];
  const ids = [];
  newestFirst.forEach((e, i) => {
    lines.push(`${i + 1}. ${spokenDate(e.id, offsetHours)} — ${gist(e)}`);
    ids.push(e.id);
  });
  return { lines, ids };
}

/**
 * The last `n` turns as (transcript, reply), oldest-first, skipping empty
 * transcripts. Filtering happens within the last-n window. (memory.rs:159-170)
 */
export function recentDialogue(entries, n) {
  return entries
    .slice().reverse().slice(0, n)
    .filter((e) => e.transcript !== '')
    .map((e) => [e.transcript, e.reply])
    .reverse();
}

/** The memory on/off gate. Off only for off|0|no|false. (memory.rs:43-46) */
export function memoryEnabled(value) {
  if (value == null) return true;
  const v = String(value).toLowerCase();
  return !(v === 'off' || v === '0' || v === 'no' || v === 'false');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/memory-catalog.test.js`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
cd tom-diary && git add js/memory.js tests/unit/memory-catalog.test.js
git commit -m "feat(memory): catalog + recentDialogue + memoryEnabled toggle"
```

---

### Task 9: Memory — the IndexedDB store (open, CRUD, prune, conjure lookup)

The one DB wiring seam. It composes the pure functions above and is unit-tested under Vitest with the **`fake-indexeddb`** devDependency (a faithful in-memory `IDBFactory`), so append/round-trip/prune/catalog/conjure-lookup all run without a browser.

**Files:**
- Modify: `tom-diary/package.json` (add `fake-indexeddb` devDependency)
- Modify: `tom-diary/js/memory.js`
- Test: `tom-diary/tests/unit/memory-store.test.js`

**Interfaces:**
- Consumes: `decimate`, `strokesToTriples`, `catalog`, `recentDialogue`, `MAX_MEMORIES` (same module).
- Produces:
  - `openMemoryDb(factory = globalThis.indexedDB) -> Promise<IDBDatabase>` — opens/creates DB `tom-diary`, object store `pages` (keyPath `id`).
  - `createMemoryStore(db, { offsetHours = 0 } = {}) -> store` with:
    - `store.all() -> Promise<Entry[]>` — all entries, ascending by `id` (oldest-first). `Entry = { id, transcript, reply, strokes }`.
    - `store.append(id, transcript, reply, inkStrokes) -> Promise<void>` — stores `{ id, transcript, reply, strokes: decimate(strokesToTriples(inkStrokes)) }`, then prunes to `MAX_MEMORIES` (oldest first).
    - `store.get(id) -> Promise<Entry | undefined>`.
    - `store.strokes(id) -> Promise<Array<Array<[x,y,r]>>> | undefined` — the stored triples for conjure replay.
    - `store.catalog(max) -> Promise<{ lines, ids }>` — `catalog(await all(), max, offsetHours)`.
    - `store.recentDialogue(n) -> Promise<Array<[transcript, reply]>>`.
    - `store.clear() -> Promise<void>`.

- [ ] **Step 1: Add the devDependency and configure the test to use it**

Add `"fake-indexeddb": "^6.0.0"` to `devDependencies` in `package.json`, then:

Run: `cd tom-diary && npm install`
Expected: `node_modules/fake-indexeddb` exists.

- [ ] **Step 2: Write the failing test**

Create `tom-diary/tests/unit/memory-store.test.js`:

```js
import 'fake-indexeddb/auto'; // installs a global indexedDB for this test file
import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDb, createMemoryStore, MAX_MEMORIES } from '../../js/memory.js';
import { IDBFactory } from 'fake-indexeddb';

let db;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // fresh DB per test
  db = await openMemoryDb();
});

const ink = [{ points: [{ x: 10, y: 20, r: 3 }, { x: 100, y: 120, r: 2 }] }];

describe('memory store', () => {
  it('round-trips an appended page and its decimated strokes', async () => {
    const s = createMemoryStore(db);
    await s.append(1751856000, 'hello tom', 'Hello. Who writes?', ink);
    const all = await s.all();
    expect(all).toHaveLength(1);
    expect(all[0].transcript).toBe('hello tom');
    expect(all[0].reply).toBe('Hello. Who writes?');
    const strokes = await s.strokes(1751856000);
    expect(strokes[0][0]).toEqual([10, 20, 3]);
    expect(strokes[0][strokes[0].length - 1]).toEqual([100, 120, 2]);
  });

  it('returns entries oldest-first regardless of insert order', async () => {
    const s = createMemoryStore(db);
    await s.append(200, 'b', 'B', ink);
    await s.append(100, 'a', 'A', ink);
    expect((await s.all()).map((e) => e.id)).toEqual([100, 200]);
  });

  it('prunes to MAX_MEMORIES, forgetting the oldest', async () => {
    const s = createMemoryStore(db);
    for (let i = 1; i <= MAX_MEMORIES + 5; i++) await s.append(i, 't' + i, 'r', ink);
    const all = await s.all();
    expect(all).toHaveLength(MAX_MEMORIES);
    expect(all[0].id).toBe(6);                 // ids 1..5 pruned
    expect(await s.get(1)).toBeUndefined();
    expect(await s.get(6)).toBeTruthy();
  });

  it('builds a catalog and maps a conjure number back to a page', async () => {
    const s = createMemoryStore(db, { offsetHours: 0 });
    await s.append(1751856000, 'about the garden', 'a', ink);
    await s.append(1751942400, 'about the rain', 'b', ink);
    const { lines, ids } = await s.catalog(10);
    expect(ids).toEqual([1751942400, 1751856000]);
    expect(lines[0]).toContain('about the rain');
    // conjure lookup: ⟦show:1⟧ -> ids[0]
    const conjured = await s.get(ids[0]);
    expect(conjured.transcript).toBe('about the rain');
  });

  it('clears all pages', async () => {
    const s = createMemoryStore(db);
    await s.append(1, 't', 'r', ink);
    await s.clear();
    expect(await s.all()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tom-diary && npx vitest run tests/unit/memory-store.test.js`
Expected: FAIL — `openMemoryDb` / `createMemoryStore` not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `tom-diary/js/memory.js`:

```js
const DB_NAME = 'tom-diary';
const STORE = 'pages';

const reqPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Open (or create) the memory DB. keyPath 'id' = the page's commit timestamp. */
export function openMemoryDb(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A CRUD + context-building facade over the pages store. */
export function createMemoryStore(db, { offsetHours = 0 } = {}) {
  const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);

  const all = async () => {
    const rows = await reqPromise(tx('readonly').getAll());
    return rows.sort((a, b) => a.id - b.id); // oldest-first
  };

  const prune = async () => {
    const rows = await all();
    if (rows.length <= MAX_MEMORIES) return;
    const store = tx('readwrite');
    for (const e of rows.slice(0, rows.length - MAX_MEMORIES)) store.delete(e.id);
    await reqPromise(store.transaction.objectStore ? store.transaction.oncomplete === null ? store.get(rows[0].id) : store.get(rows[0].id) : store.get(rows[0].id));
  };

  return {
    all,
    async append(id, transcript, reply, inkStrokes) {
      const strokes = decimate(strokesToTriples(inkStrokes));
      await reqPromise(tx('readwrite').put({ id, transcript, reply, strokes }));
      await prune();
    },
    async get(id) { return reqPromise(tx('readonly').get(id)); },
    async strokes(id) {
      const e = await reqPromise(tx('readonly').get(id));
      return e ? e.strokes : undefined;
    },
    async catalog(max) { return catalog(await all(), max, offsetHours); },
    async recentDialogue(n) { return recentDialogue(await all(), n); },
    async clear() { await reqPromise(tx('readwrite').clear()); },
  };
}
```

> The `prune` helper above must delete the oldest `rows.length - MAX_MEMORIES` entries and await transaction completion. Replace its awkward last line with a clean await of the delete transaction — see Step 5.

- [ ] **Step 5: Simplify `prune` to await transaction completion cleanly**

Replace the `prune` function body with:

```js
  const prune = async () => {
    const rows = await all();
    if (rows.length <= MAX_MEMORIES) return;
    const store = tx('readwrite');
    const done = new Promise((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
    for (const e of rows.slice(0, rows.length - MAX_MEMORIES)) store.delete(e.id);
    await done;
  };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tom-diary && npx vitest run tests/unit/memory-store.test.js`
Expected: PASS — 5 cases.

- [ ] **Step 7: Run the full unit suite**

Run: `cd tom-diary && npm test`
Expected: all Plan 1–3 unit specs pass.

- [ ] **Step 8: Commit**

```bash
cd tom-diary && git add package.json package-lock.json js/memory.js tests/unit/memory-store.test.js
git commit -m "feat(memory): IndexedDB store (append/prune/catalog/conjure) + fake-indexeddb tests"
```

---

## Open risks / things to validate during implementation

- **CORS for browser SSE.** `askOracle` runs in the browser; OpenAI itself allows browser calls, but some OpenAI-compatible providers omit CORS headers, which surfaces as a `request failed: …` error rather than a stream. This is a spec-noted risk (spec §Open risks); test against OpenAI and OpenRouter early in Plan 4's live wiring. `askOracle`'s injectable `fetch` also lets Plan 4 add a proxy transport if a provider needs one.
- **Timeout semantics.** The `AbortController` here re-arms a single timer per chunk; the connect vs. read distinction is approximate (one controller aborts both phases). `riddle`'s ureq has separate connect/read timeouts. The approximation is intentional and spec-sanctioned ("Approximate with an AbortController"), but confirm a stalled stream aborts within ~90s in Plan 4.
- **`sentenceCut` byte minimum.** The ≥4-**byte** rule is preserved via `TextEncoder`, but the parser's offsets are JS string (code-unit) indices, consistent throughout. For non-BMP replies the *positions* differ from Rust byte offsets while remaining self-consistent; the only externally observable rule (the 4-byte floor) is honored. Watch a CJK/emoji-heavy reply in Plan 4 to confirm chunking feels right.
- **`fake-indexeddb` vs. Safari IndexedDB.** The store is unit-tested against `fake-indexeddb`, a faithful spec implementation, but Safari's IndexedDB has historical quirks (e.g. transaction auto-commit timing). Plan 4 should smoke the store once on a real iPad; the store API is deliberately small so a browser spec is cheap to add if needed.
- **Prune cost.** `prune()` reads all rows (`getAll`) after every append to find the oldest. At ≤400 rows this is trivial; if memory volume grows, switch to a keyed cursor deleting from the front. Not worth optimizing now (YAGNI).
- **Stored-strokes shape for Plan 4.** `store.strokes(id)` returns `[x,y,r]` triples (integers), *not* the `{points:[{x,y,r}]}` shape the live ink uses. Plan 4's conjure replay must adapt triples → whatever `createReplyWriter`/the reveal animator consumes. Flagged so Plan 4 does not assume the live shape.

## Self-review notes

**1. Spec coverage (Plan 3 scope):**
- Oracle call: base-URL trim + headers + endpoint → Task 5; body fields (model/stream/cap/reasoning-only-when-set, no temperature/top_p) → Task 4; `max_completion_tokens` one-shot retry → Task 5; timeouts via AbortController → Task 5. ✅
- System prompt (PERSONA, MEMORY_PROTOCOL appended only when memory on) → Task 1. ✅
- Message list (system, text-only history pairs `(an earlier page) {t}` + assistant reply, current turn `[text catalog, image_url]` no detail) → Task 4. ✅
- SSE StreamParser (leading-only `⟦show:N⟧`, last-boundary sentence cut w/ 4-byte min, quote-strip, mid-prose directive strip, `⁂` transcript, `empty reply` / `unfinished` / `the diary lost that page (…)` errors) → Tasks 2–3. ✅
- Memory: IndexedDB open/CRUD → Task 9; decimation ([x,y,r], keep-last, MIN_POINT_DIST2=9) → Task 6; catalog format + spokenDate + gist → Tasks 7–8; recentDialogue (skip empty) → Task 8; prune to 400 → Task 9; conjure id lookup (`catalog.ids` + `store.get`) → Tasks 8–9; on/off toggle (off|0|no|false) → Task 8. ✅
- Testability seams (pure parser + body builder; injected-fetch streaming test; fake-indexeddb for DB; spokenDate takes explicit timestamp+offset) → stated in Architecture and Tasks 5, 7, 9. ✅
- **Explicitly NOT in this plan (deferred to Plan 4):** the app.js state machine, Thinking blot, actually inking replies via `createReplyWriter`, wiring conjure replay to the animator, the settings UI. Plan 3 delivers `askOracle` + the memory store as the integration seam. ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step contains complete code, including the two verbatim `const` strings and the full `civil`/`spokenDate` port. The one place with a two-step refinement (Task 9 `prune`) shows the final code explicitly in Step 5 rather than hand-waving. ✅

**3. Type consistency:**
- Parser `Event` shape `{ type, value }` is produced by `createStreamParser` (Task 3) and consumed identically by `askOracle`'s `dispatch` (Task 5). ✅
- `catalogIds: number[]` flows `store.catalog().ids` (Task 9) → `turn.catalogIds` → `createStreamParser(catalogIds)` (Task 5) → `catalogIds[N-1]` lookup (Task 3). ✅
- Stored stroke type `Array<Array<[x,y,r]>>` is produced by `strokesToTriples`+`decimate` (Task 6), stored/returned by `store.strokes` (Task 9), consistent throughout; the live `{points:[{x,y,r}]}` shape is only the *input* to `strokesToTriples`. ✅
- `history: Array<[transcript, reply]>` produced by `recentDialogue` (Task 8) matches `buildMessages`' destructuring `for (const [t, r] of history)` (Task 4). ✅
- `buildRequestBody({ capField })` (Task 4) matches `askOracle`'s `doRequest('max_tokens')` / `doRequest('max_completion_tokens')` calls (Task 5). ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-tom-diary-03-oracle-memory.md`. This is plan 3 of 4; Plan 4 (app.js state machine, settings, PWA) consumes `askOracle`, the memory store, and Plan 2's `createReplyWriter`/`runDissolve`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
