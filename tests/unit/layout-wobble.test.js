import { describe, it, expect } from 'vitest';
import { makeWobble } from '../../js/layout.js';

describe('makeWobble', () => {
  it('reproduces the exact deterministic sequence from seed 0x1234', () => {
    const next = makeWobble(0x1234);
    const seq = Array.from({ length: 6 }, () => next());
    expect(seq).toEqual([2, -3, 1, 1, 3, 2]);
  });

  it('stays within [-3, 3]', () => {
    const next = makeWobble(0x1234);
    for (let i = 0; i < 500; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('is independent per instance (same seed -> same sequence)', () => {
    const a = makeWobble(0x1234), b = makeWobble(0x1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
