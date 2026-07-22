// Pure geometry + stroke model for the ink surface. No DOM at module scope.

/**
 * Pressure→radius, ported from riddle main.rs:345 (normalized) + ink.rs:41 (growth cap).
 * @param {number} pressure normalized 0..1
 * @param {number|null} prevR previous point's radius, for growth smoothing
 */
export function pressureToRadius(pressure, prevR = null) {
  let r = 2 + pressure * 3;
  if (r < 2) r = 2;
  if (r > 5) r = 5;
  if (prevR != null) r = Math.min(r, prevR + 1);
  return r;
}

/**
 * Classify a stroke as a scribble-erase gesture: many horizontal direction
 * reversals packed into a short path. tom-diary original (riddle used a
 * hardware eraser).
 */
export function isEraserStroke(points, { minReversals = 4, minReversalsPerPx = 0.02 } = {}) {
  if (points.length < 4) return false;
  let pathLen = 0;
  let reversals = 0;
  let prevDir = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    pathLen += Math.hypot(dx, dy);
    const dir = Math.sign(dx);
    if (dir !== 0) {
      if (prevDir !== 0 && dir !== prevDir) reversals++;
      prevDir = dir;
    }
  }
  if (pathLen === 0) return false;
  return reversals >= minReversals && reversals / pathLen >= minReversalsPerPx;
}

export function eraseStrokes(strokes, ex, ey, radius) {
  const rr = (radius + 2) ** 2;
  const out = [];
  for (const stroke of strokes) {
    let cur = [];
    for (const p of stroke.points) {
      const d2 = (p.x - ex) ** 2 + (p.y - ey) ** 2;
      if (d2 <= rr) {
        if (cur.length) { out.push({ points: cur }); cur = []; }
      } else {
        cur.push(p);
      }
    }
    if (cur.length) out.push({ points: cur });
  }
  return out;
}

export function isPageEmpty(strokes) {
  return strokes.reduce((n, s) => n + s.points.length, 0) === 0;
}

export function createStrokeStore() {
  let strokes = [];
  let current = null;
  return {
    get strokes() { return strokes; },
    begin(pt) { current = { points: [pt] }; },
    extend(pt) { if (current) current.points.push(pt); },
    end() { if (current && current.points.length) strokes.push(current); current = null; },
    erase(x, y, r) { strokes = eraseStrokes(strokes, x, y, r); },
    clear() { strokes = []; current = null; },
  };
}
