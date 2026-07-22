import { describe, it, expect } from 'vitest';
import { looksLikeExclamation } from '../../js/help.js';

const H = 1000; // canvas height
// Tall vertical bar: 25% of canvas height, straight.
const bar = { points: Array.from({ length: 20 }, (_, i) => ({ x: 500, y: 200 + i * (250 / 19) })) };
// Small dot below the bar.
const dot = { points: [{ x: 500, y: 480 }, { x: 503, y: 483 }, { x: 501, y: 486 }] };

describe('looksLikeExclamation', () => {
  it('accepts a tall vertical bar plus a low dot', () => {
    expect(looksLikeExclamation([bar, dot], H)).toBe(true);
  });
  it('accepts a dotless tall bar', () => {
    expect(looksLikeExclamation([bar], H)).toBe(true);
  });
  it('rejects a bar shorter than 20% of canvas height', () => {
    const short = { points: Array.from({ length: 20 }, (_, i) => ({ x: 500, y: 200 + i * (150 / 19) })) };
    expect(looksLikeExclamation([short], H)).toBe(false);
  });
  it('rejects a horizontal stroke', () => {
    const horiz = { points: Array.from({ length: 20 }, (_, i) => ({ x: 200 + i * 15, y: 500 })) };
    expect(looksLikeExclamation([horiz], H)).toBe(false);
  });
  it('rejects a curved arc (a "?"-like shape)', () => {
    const arc = { points: Array.from({ length: 20 }, (_, i) => ({ x: 500 + Math.sin(i / 3) * 120, y: 200 + i * (250 / 19) })) };
    expect(looksLikeExclamation([arc], H)).toBe(false);
  });
  it('rejects 3+ strokes', () => {
    expect(looksLikeExclamation([bar, dot, dot], H)).toBe(false);
  });
});
