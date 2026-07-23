import { describe, it, expect } from 'vitest';
import { createStreamParser } from '../../js/oracle.js';

const S = '⁂';       // ⁂
const O = '⟦', C = '⟧'; // ⟦ ⟧

describe('createStreamParser', () => {
  it('streams prose in sentence chunks then the transcript at end', () => {
    const p = createStreamParser([]);
    expect(p.advance('Hello', false)).toEqual([]); // no boundary yet
    expect(p.advance('Hello. Who wri', false)).toEqual([{ type: 'ink', value: 'Hello.' }]);
    const events = p.advance(`Hello. Who writes to me? ${S} it rained all night`, true);
    expect(events).toEqual([
      { type: 'ink', value: 'Who writes to me?' },
      { type: 'transcript', value: 'it rained all night' },
    ]);
  });

  it('routes a leading ⟦show:N⟧ directive and consumes the whole body', () => {
    const p = createStreamParser([900, 800, 700]);
    expect(p.advance(`${O}sho`, false)).toEqual([]); // directive still streaming
    expect(p.advance(`${O}show:2${C}`, false)).toEqual([{ type: 'show', value: 800 }]);
    const tail = p.advance(`${O}show:2${C}\n${S} show me the garden page`, true);
    expect(tail).toEqual([{ type: 'transcript', value: 'show me the garden page' }]);
  });

  it('tolerates spacing and case in the directive', () => {
    const p = createStreamParser([42]);
    expect(p.advance(`  ${O}Show: 1${C}`, true)).toContainEqual({ type: 'show', value: 42 });
  });

  it('errors on an out-of-range page number', () => {
    const p = createStreamParser([42]);
    const ev = p.advance(`${O}show:7${C}`, true);
    expect(ev[0]).toEqual({ type: 'error', value: 'the diary lost that page (show:7)' });
  });

  it('strips a directive that appears AFTER prose instead of inking it', () => {
    const p = createStreamParser([900, 800]);
    const ev = p.advance(`Of course, let me show you. ${O}show:2${C}\n${S} show me the rain`, true);
    expect(ev).toEqual([
      { type: 'ink', value: 'Of course, let me show you.' },
      { type: 'transcript', value: 'show me the rain' },
    ]);
    expect(ev.some((e) => e.type === 'ink' && e.value.includes(O))).toBe(false);
  });

  it('errors on an empty / whitespace-only reply', () => {
    expect(createStreamParser([]).advance('', true)).toEqual([{ type: 'error', value: 'empty reply' }]);
    expect(createStreamParser([]).advance('   ', true)).toEqual([{ type: 'error', value: 'empty reply' }]);
  });

  it('errors on an unfinished ⟦ at stream end', () => {
    const ev = createStreamParser([1]).advance(`${O}show:1`, true);
    expect(ev).toEqual([{ type: 'error', value: 'unfinished conjuring directive' }]);
  });

  it('flushes plain prose with no sentinel (memory off)', () => {
    const ev = createStreamParser([]).advance('A reply without postscript', true);
    expect(ev).toEqual([{ type: 'ink', value: 'A reply without postscript' }]);
  });
});
