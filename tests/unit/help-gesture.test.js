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
  it('rejects a wide, non-vertical stroke (fails the aspect gate)', () => {
    // Tall enough (h=260 >= 20% of H) but too wide (w=400 > 0.35*h), so it is
    // rejected by the near-vertical aspect gate, not the height gate.
    const wide = { points: Array.from({ length: 20 }, (_, i) => ({ x: 200 + i * (400 / 19), y: 200 + i * (260 / 19) })) };
    expect(looksLikeExclamation([wide], H)).toBe(false);
  });
  it('rejects an asymmetric hooked bar (fails the straightness gate)', () => {
    // 15 points straight at x=500, then a 5-point hook out to x=565: width 65
    // passes the aspect gate (65 <= 0.35*250), but the max deviation from mean-x
    // (~55) exceeds 0.20*250=50, so only the straightness gate can reject it.
    const hooked = { points: [
      ...Array.from({ length: 15 }, (_, i) => ({ x: 500, y: 200 + i * (250 / 19) })),
      ...Array.from({ length: 5 }, (_, i) => ({ x: 500 + (i + 1) * 13, y: 200 + (15 + i) * (250 / 19) })),
    ] };
    expect(looksLikeExclamation([hooked], H)).toBe(false);
  });
  it('rejects 3+ strokes', () => {
    expect(looksLikeExclamation([bar, dot, dot], H)).toBe(false);
  });
});
