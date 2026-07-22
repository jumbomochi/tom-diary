import { describe, it, expect } from 'vitest';
import { thinZhangSuen } from '../../js/skeleton.js';

// Build a w×h mask from an ASCII picture ('#' = ink).
function maskFrom(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '#') m[y * w + x] = 1;
  return { m, w, h };
}
const count = (m) => m.reduce((n, v) => n + v, 0);

describe('thinZhangSuen', () => {
  it('thins a thick horizontal bar toward a 1px line', () => {
    const rows = [
      '..........',
      '.########.',
      '.########.',
      '.########.',
      '..........',
    ];
    const { m, w, h } = maskFrom(rows);
    const before = count(m);
    thinZhangSuen(m, w, h);
    const after = count(m);
    expect(after).toBeLessThan(before / 2);
    // Each occupied column collapses to a single row in the interior.
    for (let x = 2; x < w - 2; x++) {
      let col = 0;
      for (let y = 0; y < h; y++) col += m[y * w + x];
      expect(col).toBeLessThanOrEqual(1);
    }
  });

  it('returns the same array instance it mutated', () => {
    const { m, w, h } = maskFrom(['###', '###', '###']);
    expect(thinZhangSuen(m, w, h)).toBe(m);
  });

  it('leaves an already-thin single pixel untouched', () => {
    const { m, w, h } = maskFrom(['.....', '..#..', '.....']);
    thinZhangSuen(m, w, h);
    expect(count(m)).toBe(1);
  });
});
