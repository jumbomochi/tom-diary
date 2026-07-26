import { describe, it, expect } from 'vitest';
import { strokeOutline } from '../../js/render-stroke.js';

describe('strokeOutline', () => {
  it('returns a non-empty closed polygon of [x,y] points for a multi-point stroke', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 5, pressure: 0.5 },
    ];
    const out = strokeOutline(pts, { simulatePressure: true, last: true });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toHaveLength(2);
  });

  it('yields an outline for a single point (a dot)', () => {
    const out = strokeOutline([{ x: 5, y: 5, pressure: 0.5 }], { last: true });
    expect(out.length).toBeGreaterThan(0);
  });

  it('defaults missing pressure to 0.5 without throwing', () => {
    const out = strokeOutline([{ x: 0, y: 0 }, { x: 4, y: 4 }], {});
    expect(out.length).toBeGreaterThan(0);
  });
});
