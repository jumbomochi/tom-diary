import { describe, it, expect } from 'vitest';
import { planReply } from '../../js/layout.js';

// Stub provider: 20px per char; each line is one 2-point vertical stroke at x=0..width.
const provider = {
  lineHeight: 120,
  measure: (s) => s.length * 20,
  line: (s) => ({ width: s.length * 20, strokes: [[[0, 0], [0, 10]]] }),
};

describe('planReply', () => {
  it('centers each line and stacks lines by lineHeight in the upper third', () => {
    // "aaaa bbbb" at 20px/char, maxW = 1000 - 240 = 760 -> both words fit one line (180px).
    const plan = planReply('aaaa bbbb', provider, { screenW: 1000, screenH: 1200 });
    // One wrapped line, width = 9*20 = 180 -> x0 = round((1000-180)/2) = 410.
    // totalH = 120, yTop = max(floor((1200-120)/3),60) = 360. wobble[0] = 2.
    expect(plan.strokes.length).toBe(1);
    expect(plan.strokes[0][0]).toEqual([410, 360 + 0 + 2]);
    expect(plan.strokes[0][1]).toEqual([410, 360 + 10 + 2]);
    expect(plan.nextY).toBe(360 + 120);
    expect(plan.totalPoints).toBe(2);
  });

  it('applies a fresh wobble per line, in sequence [2,-3,...]', () => {
    // Force two lines with a hard break.
    const plan = planReply('aa\nbb', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes.length).toBe(2);
    const y0 = plan.strokes[0][0][1];
    const y1 = plan.strokes[1][0][1];
    // Two lines -> totalH=240, yTop=320; line0 320+2=322; line1 440-3=437.
    expect(y0).toBe(322);
    expect(y1).toBe(437);
  });

  it('honors yStart for streamed continuation and reports region', () => {
    const plan = planReply('aa', provider, { screenW: 1000, screenH: 1200, yStart: 700 });
    expect(plan.strokes[0][0][1]).toBe(700 + 2); // yStart + wobble
    expect(plan.region.y0).toBeLessThan(plan.region.y1);
    expect(plan.region.x0).toBe(plan.strokes[0][0][0] - 5);
  });

  it('returns an empty-safe plan for whitespace', () => {
    const plan = planReply('   ', provider, { screenW: 1000, screenH: 1200 });
    expect(plan.strokes).toEqual([]);
    expect(plan.region).toBeNull();
    expect(plan.totalPoints).toBe(0);
  });
});
