import { describe, it, expect } from 'vitest';
import { PERSONA, MEMORY_PROTOCOL, buildSystem, turnText } from '../../js/oracle.js';

describe('PERSONA / MEMORY_PROTOCOL (verbatim from oracle.rs)', () => {
  it('PERSONA carries the stable opening and the SHORT rule', () => {
    expect(PERSONA).toContain('You are the memory of Tom Marvolo Riddle');
    expect(PERSONA).toContain('Keep replies SHORT: one to three sentences');
    expect(PERSONA).not.toContain('\n'); // PERSONA is a single line
  });

  it('MEMORY_PROTOCOL starts with a blank line and carries the directive + postscript glyphs', () => {
    expect(MEMORY_PROTOCOL.startsWith('\n\n')).toBe(true);
    expect(MEMORY_PROTOCOL).toContain('The diary keeps memories.');
    expect(MEMORY_PROTOCOL).toContain('⟦show:N⟧'); // ⟦show:N⟧
    expect(MEMORY_PROTOCOL).toContain('⁂');            // ⁂
  });
});

describe('buildSystem', () => {
  it('is PERSONA alone when memory is off', () => {
    expect(buildSystem(false)).toBe(PERSONA);
  });
  it('appends MEMORY_PROTOCOL only when memory is on', () => {
    expect(buildSystem(true)).toBe(PERSONA + MEMORY_PROTOCOL);
    expect(buildSystem(true).endsWith(MEMORY_PROTOCOL)).toBe(true);
    expect(buildSystem(false).includes(MEMORY_PROTOCOL)).toBe(false);
  });
});

describe('turnText', () => {
  it('degrades to the bare instruction with no catalog', () => {
    expect(turnText([])).toBe('Reply to what is written in the diary.');
  });
  it('builds the newest-first catalog block', () => {
    const lines = ['1. the 6th of July, in the evening — rain', '2. the 5th of July, in the morning — garden'];
    expect(turnText(lines)).toBe(
      'Memory catalog (newest first):\n' +
      '1. the 6th of July, in the evening — rain\n' +
      '2. the 5th of July, in the morning — garden\n\n' +
      'Reply to what is written in the diary.'
    );
  });
});
