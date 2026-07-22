import { describe, it, expect } from 'vitest';
import { traceSkeleton } from '../../js/skeleton.js';

function maskFrom(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '#') m[y * w + x] = 1;
  return { m, w, h };
}

describe('traceSkeleton', () => {
  it('traces a single horizontal line into one left-to-right stroke', () => {
    const { m, w, h } = maskFrom(['......', '.####.', '......']);
    const strokes = traceSkeleton(m, w, h);
    expect(strokes.length).toBe(1);
    const xs = strokes[0].map(([x]) => x);
    expect(xs).toEqual([1, 2, 3, 4]); // endpoint-first walk, left to right
  });

  it('drops fragments shorter than minPoints', () => {
    const { m, w, h } = maskFrom(['....', '.##.', '....']); // only 2 px
    expect(traceSkeleton(m, w, h, 3)).toEqual([]);
  });

  it('returns strokes sorted by minimum x', () => {
    const { m, w, h } = maskFrom([
      '..........',
      '.###..###.', // left segment (x=1..3), right segment (x=6..8)
      '..........',
    ]);
    const strokes = traceSkeleton(m, w, h);
    expect(strokes.length).toBe(2);
    const minX = strokes.map((s) => Math.min(...s.map(([x]) => x)));
    expect(minX[0]).toBeLessThan(minX[1]);
    expect(minX[0]).toBe(1);
  });
});
