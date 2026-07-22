// Help gesture ("!") detection + guide panel. Pure detection; show/dismiss touch DOM.

function bounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * A large "!": near-vertical, roughly straight main stroke >= 20% of canvas
 * height, plus an optional small low dot. tom-diary original.
 */
export function looksLikeExclamation(strokes, canvasHeight, {
  minHeightFrac = 0.20,
  maxAspect = 0.35,       // main stroke width / height
  maxStraightDev = 0.20,  // horizontal wander / height
  maxDotFrac = 0.25,      // dot size / main height
} = {}) {
  if (strokes.length < 1 || strokes.length > 2) return false;
  const main = strokes.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  if (main.points.length < 8) return false;
  const m = bounds(main.points);
  if (m.h < minHeightFrac * canvasHeight) return false;   // tall enough
  if (m.w > maxAspect * m.h) return false;                // narrow / near-vertical
  const mx = main.points.reduce((a, p) => a + p.x, 0) / main.points.length;
  const dev = Math.max(...main.points.map((p) => Math.abs(p.x - mx)));
  if (dev > maxStraightDev * m.h) return false;           // roughly straight
  if (strokes.length === 2) {
    const dot = strokes.find((s) => s !== main);
    const d = bounds(dot.points);
    if (Math.max(d.w, d.h) > maxDotFrac * m.h) return false;  // small
    if (d.cy < m.y1) return false;                            // below the bar
    if (Math.abs(d.cx - mx) > 0.5 * m.w + 40) return false;   // roughly under center
  }
  return true;
}
