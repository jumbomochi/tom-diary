import { describe, it, expect } from 'vitest';
import { decimate, strokesToTriples, MIN_POINT_DIST2, MAX_MEMORIES } from '../../js/memory.js';

describe('constants', () => {
  it('match the ported values', () => {
    expect(MIN_POINT_DIST2).toBe(9);
    expect(MAX_MEMORIES).toBe(400);
  });
});

describe('decimate', () => {
  it('keeps first and last, drops dense interior points', () => {
    const dense = [Array.from({ length: 100 }, (_, i) => [i, 0, 3])];
    const thin = decimate(dense);
    expect(thin[0].length).toBeLessThan(40);
    expect(thin[0][0]).toEqual([0, 0, 3]);
    expect(thin[0][thin[0].length - 1]).toEqual([99, 0, 3]);
  });
  it('preserves per-point radius', () => {
    const thin = decimate([[[0, 0, 2], [10, 0, 5]]]);
    expect(thin[0]).toEqual([[0, 0, 2], [10, 0, 5]]);
  });
  it('always keeps the last point even if close to the previous kept one', () => {
    // second point is <3px away but is the last -> kept.
    expect(decimate([[[0, 0, 2], [1, 1, 2]]])[0]).toEqual([[0, 0, 2], [1, 1, 2]]);
  });
  it('drops strokes that decimate to empty is impossible (never empties a non-empty stroke)', () => {
    expect(decimate([[]])).toEqual([]);
  });
});

describe('strokesToTriples', () => {
  it('converts {points} to integer [x,y,r] triples', () => {
    const ink = [{ points: [{ x: 10.4, y: 20.6, r: 2.9 }, { x: 30, y: 40, r: 3 }] }];
    expect(strokesToTriples(ink)).toEqual([[[10, 21, 3], [30, 40, 3]]]);
  });
});
