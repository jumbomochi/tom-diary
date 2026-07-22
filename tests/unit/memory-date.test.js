import { describe, it, expect } from 'vitest';
import { spokenDate, oneLine, gist } from '../../js/memory.js';

describe('spokenDate', () => {
  it('renders 2026-07-06 23:30 UTC as a late-night 6th of July (from memory.rs)', () => {
    // 1783467000 = 2026-07-06T23:30:00Z; hour 23 -> "late at night".
    expect(spokenDate(1783467000, 0)).toBe('the 6th of July, late at night');
  });
  it('applies the tz offset before bucketing the hour', () => {
    // +1h pushes 23:30 -> 00:30 the 7th -> "in the small hours".
    expect(spokenDate(1783467000, 1)).toBe('the 7th of July, in the small hours');
  });
  it('uses the correct ordinal suffixes', () => {
    // 2026-07-01 08:00Z -> "1st"; morning bucket.
    expect(spokenDate(1782979200, 0)).toBe('the 1st of July, in the morning');
    // 2026-07-02 08:00Z -> "2nd"
    expect(spokenDate(1783065600, 0)).toBe('the 2nd of July, in the morning');
    // 2026-07-03 08:00Z -> "3rd"
    expect(spokenDate(1783152000, 0)).toBe('the 3rd of July, in the morning');
    // 2026-07-11 08:00Z -> "11th" (teens are always "th")
    expect(spokenDate(1783843200, 0)).toBe('the 11th of July, in the morning');
  });
  it('buckets time of day', () => {
    expect(spokenDate(1782950400, 0)).toContain('in the small hours'); // 2026-07-01 00:00Z
    expect(spokenDate(1782993600, 0)).toContain('in the afternoon');   // 2026-07-01 12:00Z
    expect(spokenDate(1783015200, 0)).toContain('in the evening');     // 2026-07-01 18:00Z
  });
});

describe('oneLine', () => {
  it('collapses whitespace and caps at max Unicode chars', () => {
    expect(oneLine('hello   \n  world', 100)).toBe('hello world');
    expect(oneLine('abcdefghij', 4)).toBe('abcd');
    expect(oneLine('🌧️🌧️🌧️🌧️🌧️', 2).length).toBeLessThanOrEqual('🌧️🌧️'.length + 2);
  });
});

describe('gist', () => {
  it('is the transcript when present', () => {
    expect(gist({ transcript: 'about the garden', reply: 'x' })).toBe('about the garden');
  });
  it('falls back to (reply: …) when the transcript is blank', () => {
    expect(gist({ transcript: '   ', reply: 'The ink blurred.' })).toBe('(reply: The ink blurred.)');
  });
});
