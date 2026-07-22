import { describe, it, expect } from 'vitest';
import { pressureToRadius } from '../../js/ink.js';

describe('pressureToRadius', () => {
  it('maps 0 pressure to the minimum radius 2', () => {
    expect(pressureToRadius(0)).toBe(2);
  });
  it('maps full pressure to the maximum radius 5', () => {
    expect(pressureToRadius(1)).toBe(5);
  });
  it('maps mid pressure linearly', () => {
    expect(pressureToRadius(0.5)).toBeCloseTo(3.5, 5);
  });
  it('caps growth at prevR + 1 along a stroke', () => {
    expect(pressureToRadius(1, 2)).toBe(3); // would be 5, capped to 2+1
  });
  it('clamps out-of-range pressure', () => {
    expect(pressureToRadius(-1)).toBe(2);
    expect(pressureToRadius(9)).toBe(5);
  });
});
