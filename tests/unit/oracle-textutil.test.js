import { describe, it, expect } from 'vitest';
import { sentenceCut, clean, stripDirectives } from '../../js/oracle.js';

describe('sentenceCut', () => {
  it('cuts just past a sentence-ending period followed by a space', () => {
    expect(sentenceCut('Hello. Who', 0)).toBe(6); // "Hello." then space
  });
  it('takes the LAST boundary available, batching sentences', () => {
    // periods after "One." (index 4) and "Two." (index 9); last wins.
    expect(sentenceCut('One. Two. Three', 0)).toBe(9);
  });
  it('requires at least 4 bytes past `from`', () => {
    expect(sentenceCut('Hi.', 0)).toBeNull(); // 3 bytes
    expect(sentenceCut('Halt.', 0)).toBe(5);  // 5 bytes
  });
  it('accepts an ellipsis at end-of-text', () => {
    expect(sentenceCut('It faded…', 0)).toBe('It faded…'.length);
  });
  it('returns null with no completed sentence', () => {
    expect(sentenceCut('a quiet page', 0)).toBeNull();
  });
});

describe('clean', () => {
  it('trims and strips one wrapping pair of quotes', () => {
    expect(clean('  "hello"  ')).toBe('hello');
    expect(clean('plain')).toBe('plain');
    expect(clean('"only-leading')).toBe('only-leading');
  });
});

describe('stripDirectives', () => {
  it('removes a ⟦…⟧ span and collapses whitespace', () => {
    expect(stripDirectives('a ⟦show:1⟧ b')).toBe('a b');
  });
  it('leaves directive-free text untouched', () => {
    expect(stripDirectives('plain text')).toBe('plain text');
  });
  it('drops an unterminated ⟦ tail', () => {
    expect(stripDirectives('tail ⟦show:2')).toBe('tail');
  });
});
