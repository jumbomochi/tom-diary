import { describe, it, expect } from 'vitest';
import { pxHash, shouldClear } from '../../js/dissolve.js';

describe('pxHash', () => {
  it('matches the ported reference values and is deterministic', () => {
    expect(pxHash(0, 0)).toBe(0);
    expect(pxHash(1, 0)).toBe(4061463559);
    expect(pxHash(10, 5)).toBe(pxHash(10, 5));
  });
});

describe('shouldClear', () => {
  it('clears an increasing subset as the stage rises, all by the last stage', () => {
    const stages = 14;
    const pts = [];
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) pts.push([x, y]);
    const cleared = (stage) => pts.filter(([x, y]) => shouldClear(x, y, stage, stages)).length;
    expect(cleared(0)).toBeGreaterThan(0);
    expect(cleared(0)).toBeLessThan(pts.length);
    expect(cleared(7)).toBeGreaterThan(cleared(0)); // monotonic growth
    expect(cleared(stages - 1)).toBe(pts.length);   // everything gone by the end
  });
});
