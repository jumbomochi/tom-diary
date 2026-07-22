import { describe, it, expect } from 'vitest';
import { createStrokeStore, eraseStrokes, isPageEmpty } from '../../js/ink.js';

describe('eraseStrokes', () => {
  it('splits a stroke into two when erasing its middle', () => {
    const strokes = [{ points: [
      { x: 0, y: 0, r: 2 }, { x: 10, y: 0, r: 2 }, { x: 50, y: 0, r: 2 },
      { x: 90, y: 0, r: 2 }, { x: 100, y: 0, r: 2 },
    ] }];
    const out = eraseStrokes(strokes, 50, 0, 5); // radius+2 = 7 around x=50
    expect(out).toHaveLength(2);
    expect(out[0].points.every(p => p.x < 50)).toBe(true);
    expect(out[1].points.every(p => p.x > 50)).toBe(true);
  });
  it('drops a stroke entirely when all points are erased', () => {
    const strokes = [{ points: [{ x: 0, y: 0, r: 2 }, { x: 1, y: 0, r: 2 }] }];
    expect(eraseStrokes(strokes, 0.5, 0, 5)).toHaveLength(0);
  });
});

describe('isPageEmpty', () => {
  it('is true for no strokes', () => {
    expect(isPageEmpty([])).toBe(true);
  });
  it('is false when ink points remain', () => {
    expect(isPageEmpty([{ points: [{ x: 1, y: 1, r: 2 }] }])).toBe(false);
  });
});

describe('createStrokeStore', () => {
  it('accumulates a finished stroke', () => {
    const s = createStrokeStore();
    s.begin({ x: 0, y: 0, r: 2 });
    s.extend({ x: 5, y: 0, r: 2 });
    s.end();
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].points).toHaveLength(2);
  });
});
