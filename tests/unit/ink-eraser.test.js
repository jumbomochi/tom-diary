import { describe, it, expect } from 'vitest';
import { isEraserStroke } from '../../js/ink.js';

// A straight diagonal line — normal ink, no reversals.
const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: i * 5 }));

// A tight zigzag over a short span — scribble erase.
const zigzag = Array.from({ length: 40 }, (_, i) => ({
  x: 100 + (i % 2 === 0 ? 0 : 30),
  y: 100 + i * 2,
}));

describe('isEraserStroke', () => {
  it('rejects a straight line', () => {
    expect(isEraserStroke(line)).toBe(false);
  });
  it('accepts a tight zigzag', () => {
    expect(isEraserStroke(zigzag)).toBe(true);
  });
  it('rejects a stroke too short to judge', () => {
    expect(isEraserStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});
