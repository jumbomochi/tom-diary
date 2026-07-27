// Zhang-Suen thinning + skeleton tracing. Pure grid algorithms, ported from
// riddle script.rs. Masks are Uint8Array (0/1), row-major, length w*h.

/**
 * Reduce a filled mask to a 1px-wide skeleton (Zhang-Suen). Border pixels are
 * never removed (script.rs iterates 1..h-1, 1..w-1). Mutates and returns mask.
 */
export function thinZhangSuen(mask, w, h) {
  const at = (x, y) => mask[y * w + x];
  for (;;) {
    let changed = false;
    for (let phase = 0; phase < 2; phase++) {
      const toClear = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!at(x, y)) continue;
          // p2..p9 clockwise from North (script.rs:80-89).
          const p = [
            at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1),
          ];
          let b = 0;
          for (let i = 0; i < 8; i++) b += p[i];
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          const c1 = phase === 0 ? !(p[0] && p[2] && p[4]) : !(p[0] && p[2] && p[6]);
          const c2 = phase === 0 ? !(p[2] && p[4] && p[6]) : !(p[0] && p[4] && p[6]);
          if (c1 && c2) toClear.push(y * w + x);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) mask[i] = 0;
      }
    }
    if (!changed) break;
  }
  return mask;
}

/**
 * Trace a 1px skeleton into ordered polylines. Endpoints first, then loops;
 * greedy 8-neighbor walk; drop paths under minPoints; sort by min x.
 * Ported from script.rs:128-195.
 */
export function traceSkeleton(mask, w, h, minPoints = 3) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Neighbor scan order matches the Rust dy(-1..1) outer, dx(-1..1) inner loop.
  const OFF = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const neighbors = (x, y) => {
    const out = [];
    for (const [dx, dy] of OFF) if (at(x + dx, y + dy)) out.push([x + dx, y + dy]);
    return out;
  };

  const visited = new Uint8Array(w * h);
  const seen = (x, y) => visited[y * w + x] === 1;
  const mark = (x, y) => { visited[y * w + x] = 1; };

  const starts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) && neighbors(x, y).length === 1) starts.push([x, y]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) starts.push([x, y]);

  const strokes = [];
  for (const [sx, sy] of starts) {
    if (seen(sx, sy)) continue;
    const path = [[sx, sy]];
    mark(sx, sy);
    let cx = sx, cy = sy;
    for (;;) {
      const next = neighbors(cx, cy).find(([nx, ny]) => !seen(nx, ny));
      if (!next) break;
      mark(next[0], next[1]);
      path.push(next);
      cx = next[0]; cy = next[1];
    }
    if (path.length >= minPoints) strokes.push(path);
  }
  strokes.sort((a, b) => Math.min(...a.map(([x]) => x)) - Math.min(...b.map(([x]) => x)));
  return strokes;
}

/**
 * Low-pass smooth a traced polyline: replace each interior point with the mean
 * of its neighbours within `window` on each side, repeated `passes` times.
 * Endpoints are pinned and the point count is preserved, so a downstream reveal
 * keeps the same timing (pointsPerTick / lingerMs are unaffected). This removes
 * the ±1px staircase that Zhang-Suen thinning + the 8-connected walk leave on
 * the centreline, without changing the letter shape. Points are [x,y] (integer
 * grid coords in, sub-pixel float coords out). Polylines shorter than 3 points
 * are returned as fresh [x,y] copies, unchanged in value.
 */
export function smoothPolyline(points, { passes = 2, window = 2 } = {}) {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  let cur = points.map((p) => [p[0], p[1]]);
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map((p) => [p[0], p[1]]); // endpoints copied, interiors overwritten
    for (let i = 1; i < n - 1; i++) {
      const lo = Math.max(0, i - window);
      const hi = Math.min(n - 1, i + window);
      let sx = 0, sy = 0;
      for (let j = lo; j <= hi; j++) { sx += cur[j][0]; sy += cur[j][1]; }
      const cnt = hi - lo + 1;
      next[i] = [sx / cnt, sy / cnt];
    }
    cur = next;
  }
  return cur;
}
