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

const SHOW_OPEN = '⟦';  // ⟦
const SHOW_CLOSE = '⟧'; // ⟧
const SENTINEL = '⁂';   // ⁂

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
  let timer = null;
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };

  // Each attempt gets a FRESH connect budget, then flips to the read budget the
  // moment headers arrive — so the wait for the first SSE byte (a reasoning
  // model may lead with a long silence) is bounded by READ_TIMEOUT_MS, matching
  // ureq's per-read timeout including the first read (oracle.rs:465-472).
  const doRequest = async (capField) => {
    arm(CONNECT_TIMEOUT_MS);
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody({ model, maxTokens, capField, reasoning, messages })),
      signal: controller.signal,
    });
    arm(READ_TIMEOUT_MS);
    return r;
  };

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
