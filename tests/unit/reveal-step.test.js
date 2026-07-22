import { describe, it, expect } from 'vitest';
import { stepReveal, lingerMs } from '../../js/reveal.js';

describe('stepReveal', () => {
  const strokes = [[[0, 0], [1, 1], [2, 2]], [[10, 10], [11, 11]]];

  it('emits a null-from op for a stroke start, then connected ops', () => {
    const { ops, cursor, done } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 2);
    expect(ops).toEqual([
      { x: 0, y: 0, from: null },
      { x: 1, y: 1, from: [0, 0] },
    ]);
    expect(cursor).toEqual({ strokeI: 0, pointI: 2 });
    expect(done).toBe(false);
  });

  it('crosses a stroke boundary within one budget and starts the next with null from', () => {
    // budget large enough to finish stroke 0 (3 pts) and start stroke 1.
    const { ops, done } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 4);
    expect(ops[2]).toEqual({ x: 2, y: 2, from: [1, 1] });
    expect(ops[3]).toEqual({ x: 10, y: 10, from: null }); // stroke 1 first point
    expect(done).toBe(false);
  });

  it('reports done once all points are consumed', () => {
    const { done, cursor } = stepReveal({ strokeI: 0, pointI: 0 }, strokes, 100);
    expect(done).toBe(true);
    expect(cursor.strokeI).toBeGreaterThanOrEqual(strokes.length);
  });
});

describe('lingerMs', () => {
  it('is 4000 + points*2, capped at 20000', () => {
    expect(lingerMs(0)).toBe(4000);
    expect(lingerMs(100)).toBe(4200);
    expect(lingerMs(100000)).toBe(20000);
  });
});
