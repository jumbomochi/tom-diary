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
