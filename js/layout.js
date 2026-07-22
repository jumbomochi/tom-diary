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
