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
