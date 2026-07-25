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

describe('reduce — oracle events during drinking are buffered until drinkDone', () => {
  it('buffers ink and, on drinkDone, writes it and enters replying', () => {
    const { state, effects } = run([
      commit,
      { type: 'oracleInk', text: 'Hello.' },
      { type: 'drinkDone' },
    ]);
    expect(state.name).toBe('replying');
    expect(state.reply).toBe('Hello.');
    expect(types(effects)).toContain('write');
    expect(effects.find((e) => e.type === 'write').text).toBe('Hello.');
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

describe('reduce — thinking', () => {
  it('first ink turns off the blot, cancels patience, and writes', () => {
    const { state, effects } = run([commit, { type: 'drinkDone' }, { type: 'oracleInk', text: 'Who writes?' }]);
    expect(state.name).toBe('replying');
    expect(effects).toContainEqual({ type: 'blot', on: false });
    expect(effects).toContainEqual({ type: 'cancelTimer', name: 'patience' });
    expect(effects).toContainEqual({ type: 'write', text: 'Who writes?' });
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
    const w = effects.find((e) => e.type === 'write');
    expect(w.text).toContain('Wi-Fi'); // oracleExcuse('timed out')
  });
});

describe('reduce — replying → lingering (persist) → fading → listening', () => {
  it('appends streamed chunks and lingers only once the stream ends AND the reveal drains', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'drinkDone' });        // -> thinking
    r = reduce(r.state, { type: 'oracleInk', text: 'Hello.' }); // -> replying, write
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 80, region: regionA });
    r = reduce(r.state, { type: 'oracleInk', text: 'Who writes?' }); // append
    expect(r.effects).toContainEqual({ type: 'append', text: 'Who writes?' });
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 120, region: regionB });
    // reveal drains before the stream ends: stay replying
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('replying');
    // stream ends: now go to lingering, persist, schedule linger with the summed points
    r = reduce(r.state, { type: 'oracleEnd' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects).toContainEqual({ type: 'persist', id: 1751856000, transcript: '', reply: 'Hello. Who writes?' });
    expect(r.effects).toContainEqual({ type: 'schedule', name: 'linger', ms: Math.min(4000 + 200 * 2, 20000) });
  });
  it('a stored transcript rides along to persist', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'oracleInk', text: 'Hi.' });
    r = reduce(r.state, { type: 'drinkDone' });
    r = reduce(r.state, { type: 'oracleTranscript', text: 'the rain came' });
    r = reduce(r.state, { type: 'oracleEnd' });
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
  it('threads the reply region (unioned across reveals) all the way to the fade dissolve', () => {
    // Full path: commit -> drinking (with buffered chunk) -> replying ->
    // revealPlanned(A) -> append + revealPlanned(B) -> oracleEnd + revealDrained
    // -> lingering -> (timer linger) -> fading. The fade must erase the whole reply.
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'oracleInk', text: 'Hello.' });
    r = reduce(r.state, { type: 'drinkDone' });                     // -> replying
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 80, region: regionA });
    r = reduce(r.state, { type: 'oracleInk', text: 'Who writes?' });
    r = reduce(r.state, { type: 'revealPlanned', totalPoints: 120, region: regionB });
    r = reduce(r.state, { type: 'oracleEnd' });
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    const expected = unionRegion(regionA, regionB);
    expect(r.state.region).toEqual(expected);
    r = reduce(r.state, { type: 'timer', name: 'linger' });
    expect(r.state.name).toBe('fading');
    const fade = r.effects.find((e) => e.type === 'dissolve' && e.kind === 'fade');
    expect(fade).toBeTruthy();
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
  it('errors mid-thinking → replying(excuse), failed, no persist on drain', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'drinkDone' });
    r = reduce(r.state, { type: 'oracleError', text: 'http 401: bad key' });
    expect(r.state.name).toBe('replying');
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toContain('refused');
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.some((e) => e.type === 'persist')).toBe(false);
  });
  it('buffered ink plus a co-arriving error keeps the real reply but marks the turn failed (no persist)', () => {
    let r = reduce(initialState(), commit);
    r = reduce(r.state, { type: 'oracleInk', text: 'The rain fell.' }); // buffered during drinking
    r = reduce(r.state, { type: 'oracleError', text: 'http 500: boom' }); // error also buffered
    r = reduce(r.state, { type: 'drinkDone' });
    expect(r.state.name).toBe('replying');
    expect(r.state.reply).toBe('The rain fell.'); // real ink, NOT the excuse
    expect(r.state.failed).toBe(true);
    expect(r.effects.find((e) => e.type === 'write').text).toBe('The rain fell.');
    r = reduce(r.state, { type: 'revealDrained' });
    expect(r.state.name).toBe('lingering');
    expect(r.effects.some((e) => e.type === 'persist')).toBe(false);
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
  it('ink events are ignored while drinking is not the concern (no crash on stray events)', () => {
    expect(reduce({ name: 'fading', region }, { type: 'penTap' }).state.name).toBe('fading');
    expect(reduce(initialState(), { type: 'oracleInk', text: 'x' }).state.name).toBe('listening');
  });
});
