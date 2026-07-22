import { describe, it, expect } from 'vitest';
import { wrapLines } from '../../js/layout.js';

// Stub measure: every char is 10px wide (spaces included).
const measure = (s) => s.length * 10;

describe('wrapLines', () => {
  it('greedily fills lines up to maxW', () => {
    const lines = wrapLines('aa bb cc dd', 59, measure); // fits "aa bb" (50), not "aa bb cc"
    expect(lines).toEqual(['aa bb', 'cc dd']);
  });

  it('overflows a single word wider than maxW rather than breaking it', () => {
    const lines = wrapLines('supercalifragilistic', 50, measure);
    expect(lines).toEqual(['supercalifragilistic']);
  });

  it('preserves explicit newlines as hard breaks', () => {
    const lines = wrapLines('aa\nbb cc', 999, measure);
    expect(lines).toEqual(['aa', 'bb cc']);
  });

  it('collapses runs of whitespace within a paragraph', () => {
    expect(wrapLines('aa    bb', 999, measure)).toEqual(['aa bb']);
  });
});
