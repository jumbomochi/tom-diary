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
