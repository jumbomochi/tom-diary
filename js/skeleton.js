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
