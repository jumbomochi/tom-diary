import { describe, it, expect } from 'vitest';
import { smoothPolylineTaubin, smoothPolyline } from '../../js/skeleton.js';

// Summed squared second difference — a jaggedness/curvature-noise measure.
function jaggedness(pts) {
  let s = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ddx = pts[i + 1][0] - 2 * pts[i][0] + pts[i - 1][0];
    const ddy = pts[i + 1][1] - 2 * pts[i][1] + pts[i - 1][1];
    s += ddx * ddx + ddy * ddy;
  }
  return s;
}
const peakY = (pts) => Math.max(...pts.map(([, y]) => Math.abs(y)));

describe('smoothPolylineTaubin', () => {
  it('preserves point count and pins the endpoints', () => {
    const pts = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]];
    const out = smoothPolylineTaubin(pts, { iters: 10 });
    expect(out).toHaveLength(pts.length);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([4, 0]);
  });

  it('strongly removes ±1px staircase wobble', () => {
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push([i, i % 2]);
    const before = jaggedness(pts);
    const after = jaggedness(smoothPolylineTaubin(pts, { iters: 20 }));
    expect(after).toBeLessThan(before * 0.1);
  });

  it('leaves a straight line straight', () => {
    const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
    const out = smoothPolylineTaubin(pts, { iters: 20 });
    for (const [, y] of out) expect(Math.abs(y)).toBeLessThan(1e-9);
  });

  it('preserves a smooth low-frequency bump far better than box averaging (anti-shrink)', () => {
    const N = 40, A = 10;
    const arc = Array.from({ length: N + 1 }, (_, i) => [i, A * Math.sin((Math.PI * i) / N)]);
    const taubin = peakY(smoothPolylineTaubin(arc, { iters: 20 }));
    const box = peakY(smoothPolyline(arc, { passes: 4, window: 3 }));
    expect(taubin).toBeGreaterThan(0.85 * A); // Taubin keeps the shape's amplitude
    expect(taubin).toBeGreaterThan(box);      // and shrinks less than a box filter
  });

  it('returns short polylines (<3 points) unchanged in value', () => {
    expect(smoothPolylineTaubin([[1, 2], [3, 4]], { iters: 10 })).toEqual([[1, 2], [3, 4]]);
  });
});
