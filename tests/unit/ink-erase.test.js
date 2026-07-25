import { describe, it, expect } from 'vitest';
import { eraseStrokes, isEraserStroke } from '../../js/ink.js';

describe('eraseStrokes', () => {
  it('removes points within the eraser radius and splits the stroke', () => {
    const strokes = [{ points: [
      { x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0.5 }, { x: 30, y: 0, pressure: 0.5 },
    ] }];
    // Erase around x=10..20 -> the stroke splits into the surviving ends.
    const out = eraseStrokes(strokes, 15, 0, 8);
    const survivingX = out.flatMap((s) => s.points.map((p) => p.x));
    expect(survivingX).toContain(0);
    expect(survivingX).toContain(30);
    expect(survivingX).not.toContain(10);
    expect(survivingX).not.toContain(20);
  });

  it('leaves strokes fully outside the radius untouched', () => {
    const strokes = [{ points: [{ x: 100, y: 100, pressure: 0.5 }, { x: 120, y: 100, pressure: 0.5 }] }];
    const out = eraseStrokes(strokes, 0, 0, 10);
    expect(out).toHaveLength(1);
    expect(out[0].points).toHaveLength(2);
  });
});

describe('isEraserStroke', () => {
  it('classifies a tight back-and-forth scribble as an erase gesture', () => {
    const pts = [];
    for (let i = 0; i < 12; i++) pts.push({ x: 100 + (i % 2 === 0 ? 0 : 6), y: 100 });
    expect(isEraserStroke(pts)).toBe(true);
  });
});
