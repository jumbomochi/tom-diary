import { describe, it, expect } from 'vitest';
import { catalog, recentDialogue, memoryEnabled } from '../../js/memory.js';

// oldest-first entries (as the store keeps them)
const entries = [
  { id: 1751856000, transcript: 'about the garden', reply: 'a' },
  { id: 1751942400, transcript: 'about the rain', reply: 'b' },
];

describe('catalog', () => {
  it('numbers newest-first and maps ids back', () => {
    const { lines, ids } = catalog(entries, 10, 0);
    expect(ids).toEqual([1751942400, 1751856000]);
    expect(lines[0].startsWith('1. ')).toBe(true);
    expect(lines[0]).toContain('about the rain');
    expect(lines[1]).toContain('about the garden');
    expect(lines[0]).toContain(' — '); // em-dash separator
  });
  it('caps at max', () => {
    expect(catalog(entries, 1, 0).ids).toEqual([1751942400]);
  });
});

describe('recentDialogue', () => {
  it('returns oldest-first (transcript, reply) pairs', () => {
    expect(recentDialogue(entries, 10)).toEqual([
      ['about the garden', 'a'],
      ['about the rain', 'b'],
    ]);
  });
  it('skips entries with an empty transcript, within the last n window', () => {
    const withBlank = [
      { id: 1, transcript: 'first', reply: 'a' },
      { id: 2, transcript: '', reply: 'b' },
      { id: 3, transcript: 'third', reply: 'c' },
    ];
    expect(recentDialogue(withBlank, 2)).toEqual([['third', 'c']]); // window = last 2 {id2,id3}; id2 dropped
  });
});

describe('memoryEnabled', () => {
  it('is off for the off-values only', () => {
    for (const v of ['off', '0', 'no', 'false', 'OFF', 'False']) expect(memoryEnabled(v)).toBe(false);
  });
  it('is on for anything else, including unset', () => {
    for (const v of [undefined, null, 'on', '1', 'yes', 'true', '']) expect(memoryEnabled(v)).toBe(true);
  });
});
