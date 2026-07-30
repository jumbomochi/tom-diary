import { describe, it, expect } from 'vitest';
import { initialState, reduce, unionRegion } from '../../js/statemachine.js';

// Drive a sequence of events, returning the final {state, effects-of-last-step}.
function run(events, start = initialState()) {
  let state = start;
  let effects = [];
  for (const ev of events) ({ state, effects } = reduce(state, ev));
  return { state, effects };
}
const types = (effects) => effects.map((e) => e.type);
const region = { x0: 10, y0: 10, x1: 100, y1: 100 };
const regionA = { x0: 20, y0: 30, x1: 120, y1: 60 };
const regionB = { x0: 15, y0: 50, x1: 140, y1: 90 };
const commit = { type: 'commit', uri: 'data:image/png;base64,AAA', region, id: 1751856000 };

describe('reduce — commit starts the drink and the oracle concurrently', () => {
  it('clears ink, starts the oracle, and dissolves — entering drinking', () => {
    const { state, effects } = reduce(initialState(), commit);
    expect(state.name).toBe('drinking');
    expect(state.id).toBe(1751856000);
    expect(types(effects)).toEqual(['clearInk', 'startOracle', 'dissolve']);
    expect(effects.find((e) => e.type === 'dissolve').kind).toBe('drink');
    expect(effects.find((e) => e.type === 'startOracle').uri).toBe(commit.uri);
  });
  it('a large-! help gesture opens the panel instead of committing', () => {
    const { state, effects } = reduce(initialState(), { type: 'help' });
    expect(state.name).toBe('help');
    expect(types(effects)).toEqual(['openHelp']);
  });
});

describe('reduce — the whole reply is buffered until the stream ends, then written once', () => {
  it('ink without a stream-end at drinkDone keeps buffering (thinking, no write yet)', () => {
    const { state, effects } = run([commit, { type: 'oracleInk', text: 'Hello.' }, { type: 'drinkDone' }]);
    expect(state.name).toBe('thinking');
    expect(state.chunks).toEqual(['Hello.']);
    expect(types(effects)).not.toContain('write');
    expect(effects).toContainEqual({ type: 'blot', on: true });
  });
  it('a stream that ended during the drink writes the full reply on drinkDone', () => {
    const { state, effects } = run([
      commit,
      { type: 'oracleInk', text: 'Hello.' },
      { type: 'oracleEnd' },
      { type: 'drinkDone' },
    ]);
    expect(state.name).toBe('replying');
    expect(state.reply).toBe('Hello.');
    expect(effects.find((e) => e.type === 'write').text).toBe('Hello.');
  });
  it('multiple buffered sentences are joined into one write', () => {
    const { state, effects } = run([
      commit,
      { type: 'oracleInk', text: 'Hello.' },
      { type: 'oracleInk', text: 'Who writes?' },
      { type: 'oracleEnd' },
      { type: 'drinkDone' },
    ]);
    expect(state.name).toBe('replying');
    expect(state.reply).toBe('Hello. Who writes?');
    expect(effects.find((e) => e.type === 'write').text).toBe('Hello. Who writes?');
    expect(types(effects)).not.toContain('append');
  });
  it('with no oracle event yet, drinkDone enters thinking (blot + patience timer)', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }]);
    expect(state.name).toBe('thinking');
    expect(effects).toContainEqual({ type: 'blot', on: true });
    expect(effects).toContainEqual({ type: 'schedule', name: 'patience', ms: 120000 });
  });
  it('a buffered show:N leads straight to conjuring', () => {
    const { state, effects } = run([commit, { type: 'oracleShow', id: 42 }, { type: 'drinkDone' }]);
    expect(state.name).toBe('conjuring');
    expect(effects).toContainEqual({ type: 'conjure', id: 42 });
  });
});

describe('reduce — thinking buffers the stream, writes on oracleEnd', () => {
  it('ink in thinking buffers (no write) and only writes when the stream ends', () => {
    let r = run([commit, { type: 'drinkDone' }, { type: 'oracleInk', text: 'a' }, { type: 'oracleInk', text: 'b' }]);
    expect(r.state.name).toBe('thinking');
    expect(r.state.chunks).toEqual(['a', 'b']);
    expect(types(r.effects)).not.toContain('write');
    // Stream ends -> the blot goes off, patience is cancelled, and the full reply is written.
    r = reduce(r.state, { type: 'oracleEnd' });
    expect(r.state.name).toBe('replying');
    expect(r.state.reply).toBe('a b');
    expect(r.effects).toContainEqual({ type: 'blot', on: false });
    expect(r.effects).toContainEqual({ type: 'cancelTimer', name: 'patience' });
    expect(r.effects.find((e) => e.type === 'write').text).toBe('a b');
  });
  it('a transcript-only event keeps thinking and stores the transcript', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'oracleTranscript', text: 'it rained' }]);
    expect(state.name).toBe('thinking');
    expect(state.transcript).toBe('it rained');
    expect(effects).toEqual([]);
  });
  it('a show:N in thinking conjures', () => {
    const { state } = run([commit, { type: 'drinkDone' }, { type: 'oracleShow', id: 7 }]);
    expect(state.name).toBe('conjuring');
  });
  it('the patience timeout inks a "timed out" excuse (no persist)', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'timer', name: 'patience' }]);
    expect(state.name).toBe('replying');
    expect(state.failed).toBe(true);
    expect(effects.find((e) => e.type === 'write').text).toContain('Wi-Fi'); // oracleExcuse('timed out')
  });
});

describe('reduce — replying → lingering (persist) → fading → listening', () => {
  it('reveals the full reply, then lingers (persist) once the reveal drains', () => {
    let r = run([
      commit,
      { type: 'oracleInk', text: 'Hello.' },
      { type: 'oracleInk', text: 'Who writes?' },
      { type: 'oracleEnd' },
      { type: 'drinkDone' }, // -> replying, single write
    ]);
    expect(r.state.name).toBe('replying');
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 200, region: regionA });
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects).toContainEqual({ type: 'persist', id: 1751856000, transcript: '', reply: 'Hello. Who writes?' });
    expect(r.effects).toContainEqual({ type: 'schedule', name: 'linger', ms: Math.min(4000 + 200 * 2, 20000) });
  });
  it('a stored transcript rides along to persist', () => {
    let r = run([
      commit,
      { type: 'oracleInk', text: 'Hi.' },
      { type: 'oracleTranscript', text: 'the rain came' },
      { type: 'oracleEnd' },
      { type: 'drinkDone' },
    ]);
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.find((e) => e.type === 'persist').transcript).toBe('the rain came');
  });
  it('the linger timer fades, and fadeDone returns to a blank listening page', () => {
    let r = reduce({ name: 'lingering', region }, { type: 'timer', name: 'linger' });
    expect(r.state.name).toBe('fading');
    expect(r.effects).toContainEqual({ type: 'dissolve', region, kind: 'fade' });
    r = reduce(r.state, { type: 'fadeDone' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'clearScreen' });
  });
  it('a pen tap during lingering fades early', () => {
    const r = reduce({ name: 'lingering', region }, { type: 'penTap' });
    expect(r.state.name).toBe('fading');
    expect(r.effects).toContainEqual({ type: 'cancelTimer', name: 'linger' });
    expect(r.effects).toContainEqual({ type: 'dissolve', region, kind: 'fade' });
  });
  it('threads the reply region (unioned across reveal-planned events) to the fade dissolve', () => {
    let r = run([
      commit, { type: 'oracleInk', text: 'Hello.' }, { type: 'oracleEnd' }, { type: 'drinkDone' },
    ]);
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 80, region: regionA });
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 120, region: regionB });
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    const expected = unionRegion(regionA, regionB);
    expect(r.state.region).toEqual(expected);
    r = reduce(r.state, { type: 'timer', name: 'linger' });
    expect(r.state.name).toBe('fading');
    const fade = r.effects.find((e) => e.type === 'dissolve' && e.kind === 'fade');
    expect(fade.region).toEqual(expected);
    expect(fade.region).not.toBeNull();
  });
});

describe('unionRegion', () => {
  it('returns the other when one side is null, else the bounding box', () => {
    expect(unionRegion(null, regionA)).toBe(regionA);
    expect(unionRegion(regionB, null)).toBe(regionB);
    expect(unionRegion(regionA, regionB)).toEqual({
      x0: Math.min(regionA.x0, regionB.x0), y0: Math.min(regionA.y0, regionB.y0),
      x1: Math.max(regionA.x1, regionB.x1), y1: Math.max(regionA.y1, regionB.y1),
    });
  });
});

describe('reduce — an oracle error inks an excuse without persisting', () => {
  it('an error with no ink → excuse on stream-end, failed, no persist on drain', () => {
    let r = run([
      commit, { type: 'drinkDone' },
      { type: 'oracleError', text: 'http 401: bad key' }, // buffered in thinking
      { type: 'oracleEnd' },                              // resolve -> excuse
    ]);
    expect(r.state.name).toBe('replying');
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toContain('refused');
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.some((e) => e.type === 'persist')).toBe(false);
  });
  it('buffered ink plus a co-arriving error keeps the real reply but marks the turn failed (no persist)', () => {
    let r = run([
      commit,
      { type: 'oracleInk', text: 'The rain fell.' }, // buffered during drinking
      { type: 'oracleError', text: 'http 500: boom' }, // error also buffered
      { type: 'oracleEnd' },
      { type: 'drinkDone' },
    ]);
    expect(r.state.name).toBe('replying');
    expect(r.state.reply).toBe('The rain fell.'); // real ink, NOT the excuse
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toBe('The rain fell.');
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.some((e) => e.type === 'persist')).toBe(false);
  });
  it('an empty stream (no ink, no error) inks the "said nothing" excuse', () => {
    const r = run([commit, { type: 'oracleEnd' }, { type: 'drinkDone' }]);
    expect(r.state.name).toBe('replying');
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toContain('said nothing');
  });
});

describe('reduce — help / conjuring / memory dismissal', () => {
  it('help dismiss returns to listening', () => {
    const r = reduce({ name: 'help' }, { type: 'helpDismissed' });
    expect(r.state.name).toBe('listening');
  });
  it('conjureDrained rests in memory for 120s', () => {
    const r = reduce({ name: 'conjuring' }, { type: 'conjureDrained' });
    expect(r.state.name).toBe('memory');
    expect(r.effects).toContainEqual({ type: 'schedule', name: 'memory', ms: 120000 });
  });
  it('a pen tap while conjuring restores today\'s page and listens', () => {
    const r = reduce({ name: 'conjuring' }, { type: 'penTap' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'restoreCanvas' });
  });
  it('memory dismiss (tap or timer) restores and listens', () => {
    expect(reduce({ name: 'memory' }, { type: 'penTap' }).state.name).toBe('listening');
    const r = reduce({ name: 'memory' }, { type: 'timer', name: 'memory' });
    expect(r.state.name).toBe('listening');
    expect(r.effects).toContainEqual({ type: 'restoreCanvas' });
  });
  it('stray events do not crash idle states', () => {
    expect(reduce({ name: 'fading', region }, { type: 'penTap' }).state.name).toBe('fading');
    expect(reduce(initialState(), { type: 'oracleInk', text: 'x' }).state.name).toBe('listening');
  });
});
