import { describe, it, expect } from 'vitest';
import { smoothPolyline } from '../../js/skeleton.js';

// Summed squared second difference — a simple jaggedness/curvature-noise measure.
function jaggedness(pts) {
  let s = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ddx = pts[i + 1][0] - 2 * pts[i][0] + pts[i - 1][0];
    const ddy = pts[i + 1][1] - 2 * pts[i][1] + pts[i - 1][1];
    s += ddx * ddx + ddy * ddy;
  }
  return s;
}

describe('smoothPolyline', () => {
  it('preserves point count and pins the endpoints', () => {
    const pts = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]];
    const out = smoothPolyline(pts, { passes: 2, window: 2 });
    expect(out).toHaveLength(pts.length);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([4, 0]);
  });

  it('reduces the ±1px staircase jaggedness by more than half', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push([i, i % 2]); // rising line with 0,1,0,1 wobble
    const before = jaggedness(pts);
    const after = jaggedness(smoothPolyline(pts, { passes: 2, window: 2 }));
    expect(after).toBeLessThan(before * 0.5);
  });

  it('leaves a straight line straight', () => {
    const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const out = smoothPolyline(pts, { passes: 3, window: 2 });
    for (const [, y] of out) expect(Math.abs(y)).toBeLessThan(1e-9);
  });

  it('returns short polylines (<3 points) unchanged in value', () => {
    expect(smoothPolyline([[1, 2], [3, 4]], { passes: 2, window: 2 })).toEqual([[1, 2], [3, 4]]);
  });
});
