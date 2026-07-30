import { describe, it, expect } from 'vitest';
import { planReply } from '../../js/layout.js';

// Stub provider: 20px per char; each line is one 2-point vertical stroke.
const provider = {
  lineHeight: 120,
  measure: (s) => s.length * 20,
  line: (s) => ({ width: s.length * 20, strokes: [[[0, 0], [0, 10]]] }),
};
const firstYs = (plan) => plan.strokes.map((s) => s[0][1]);

describe('planReply', () => {
  it('centers a short reply vertically and horizontally (no scaling)', () => {
    // "aaaa bbbb" = 9 chars = 180px <= maxW(760) -> one line.
    // centered y = floor((1200 - 120)/2) = 540; x0 = round((1000-180)/2) = 410; wob[0] = 2.
    const plan = planReply('aaaa bbbb', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes.length).toBe(1);
    expect(plan.strokes[0][0]).toEqual([410, 542]);
    expect(plan.strokes[0][1]).toEqual([410, 552]);
    expect(plan.totalPoints).toBe(2);
  });

  it('applies a fresh wobble per line, in sequence', () => {
    // two lines totalH=240, centered y=(1200-240)/2=480; line0 wob 2 -> 482; line1 480+120-3=597.
    const plan = planReply('aa\nbb', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes.length).toBe(2);
    expect(plan.strokes[0][0][1]).toBe(482);
    expect(plan.strokes[1][0][1]).toBe(597);
  });

  it('does not scale up a short reply (line spacing stays at base lineHeight)', () => {
    const plan = planReply('aa\nbb', provider, { screenW: 1000, screenH: 1200 });
    const ys = firstYs(plan);
    expect(ys[1] - ys[0]).toBeGreaterThan(100); // ~120, unscaled
  });

  it('scales a too-tall reply down to fit the usable height (never truncates)', () => {
    // 6 hard-broken lines: base totalH = 720. screenH 480, marginY 60 -> availH 360 -> scale 0.5.
    const plan = planReply('a\nb\nc\nd\ne\nf', provider, { screenW: 1000, screenH: 480 });
    expect(plan.strokes.length).toBe(6);
    const ys = firstYs(plan);
    expect(ys[1] - ys[0]).toBeLessThan(90); // compressed from base 120
    // whole block fits within the usable height (+ small wobble/pad tolerance)
    expect(plan.region.y1 - plan.region.y0).toBeLessThanOrEqual(480 - 2 * 60 + 12);
    expect(plan.totalPoints).toBe(12); // count preserved (2 pts * 6 lines)
  });

  it('honors yStart for conjure and does not scale', () => {
    const plan = planReply('aa', provider, { screenW: 1000, screenH: 1200, yStart: 700 });
    expect(plan.strokes[0][0][1]).toBe(702); // 700 + wob 2, unscaled
    expect(plan.region.x0).toBe(plan.strokes[0][0][0] - 5);
  });

  it('returns an empty-safe plan for whitespace', () => {
    const plan = planReply('   ', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes).toEqual([]);
    expect(plan.region).toBeNull();
    expect(plan.totalPoints).toBe(0);
  });
});
