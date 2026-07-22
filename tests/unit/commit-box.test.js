import { describe, it, expect } from 'vitest';
import { computeCommitBox } from '../../js/commit.js';

const strokes = [{ points: [
  { x: 100, y: 100, r: 2 },
  { x: 300, y: 260, r: 4 },
] }];

describe('computeCommitBox', () => {
  it('crops to bbox + 20px pad, clamped to canvas', () => {
    const box = computeCommitBox(strokes, 2000, 2000);
    // bbox with radius: x[98..304], y[98..264]; +20 pad
    expect(box.x0).toBe(78);
    expect(box.y0).toBe(78);
    expect(box.w).toBe((304 + 20) - 78);
    expect(box.h).toBe((264 + 20) - 78);
  });
  it('clamps the pad at the canvas edge', () => {
    const box = computeCommitBox([{ points: [{ x: 5, y: 5, r: 2 }] }], 1000, 1000);
    expect(box.x0).toBe(0);
    expect(box.y0).toBe(0);
  });
  it('always downscales at least 2x', () => {
    const box = computeCommitBox([{ points: [{ x: 10, y: 10, r: 2 }, { x: 40, y: 40, r: 2 }] }], 1000, 1000);
    expect(box.factor).toBe(2); // small page still halved
  });
  it('scales large pages so the long side is <= 800', () => {
    const box = computeCommitBox([{ points: [{ x: 0, y: 0, r: 2 }, { x: 3200, y: 100, r: 2 }] }], 4000, 4000);
    expect(box.factor).toBe(Math.ceil((3200 + 2 + 20 + 20) / 800));
    expect(Math.max(box.outW, box.outH)).toBeLessThanOrEqual(800);
  });
  it('returns null for an empty page', () => {
    expect(computeCommitBox([], 1000, 1000)).toBeNull();
  });
});
