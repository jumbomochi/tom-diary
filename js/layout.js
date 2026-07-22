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
