import { describe, it, expect } from 'vitest';
import { triplesToPolylines, planConjure } from '../../js/statemachine.js';

describe('triplesToPolylines', () => {
  it('drops the radius, keeping x,y in order', () => {
    expect(triplesToPolylines([[[1, 2, 3], [4, 5, 6]]])).toEqual([[[1, 2], [4, 5]]]);
  });
});

// Stub providers: each line is one horizontal 2-point stroke of `width`.
const headProvider = { lineHeight: 68, measure: (s) => s.length * 10, line: (s) => ({ width: s.length * 10, strokes: [[[0, 0], [s.length * 10, 0]]] }) };
const replyProvider = { lineHeight: 120, measure: (s) => s.length * 20, line: (s) => ({ width: s.length * 20, strokes: [[[0, 0], [s.length * 20, 0]]] }) };

describe('planConjure', () => {
  const entry = {
    id: 1751856000,
    dateText: 'the 7th of July, in the morning',
    reply: 'Hello again.',
    strokes: [[[300, 400, 2], [360, 460, 3]]], // the writer's own hand, mid-page
  };

  it('stacks heading, then user strokes, then reply, all in one plan', () => {
    const plan = planConjure(headProvider, replyProvider, entry, { screenW: 1000, screenH: 1200 });
    // heading first (near the top), user strokes present verbatim, reply below.
    expect(plan.strokes.length).toBeGreaterThanOrEqual(3);
    // the user's own strokes appear as [x,y] pairs, unchanged in position
    expect(plan.strokes).toContainEqual([[300, 400], [360, 460]]);
    // heading centered at headY (64): its first stroke starts at y=64
    const heading = plan.strokes[0];
    expect(heading[0][1]).toBe(64);
    // region covers the user ink and is padded
    expect(plan.region.x0).toBeLessThanOrEqual(300 - 5);
    expect(plan.region.y1).toBeGreaterThanOrEqual(460 + 5);
  });

  it('places the reply below the lowest user ink (inkBottom + 130)', () => {
    const plan = planConjure(headProvider, replyProvider, entry, { screenW: 1000, screenH: 1200 });
    const replyStroke = plan.strokes[plan.strokes.length - 1];
    // user ink bottom is y=460 -> reply starts near 460 + 130 = 590
    expect(replyStroke[0][1]).toBeGreaterThanOrEqual(560);
  });

  it('omits the reply block when the stored reply is empty', () => {
    const plan = planConjure(headProvider, replyProvider, { ...entry, reply: '' }, { screenW: 1000, screenH: 1200 });
    // heading (1) + one user stroke (1) = 2 strokes, no reply
    expect(plan.strokes.length).toBe(2);
  });
});
