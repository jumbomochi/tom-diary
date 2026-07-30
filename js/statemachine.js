// The diary's brain: a pure 9-state reducer plus the pure helpers the driver
// composes (error copy, stroke conversion, conjure planning). No DOM, no
// canvas, no timers, no clock. Ported from riddle/src/main.rs's run() loop.
import { lingerMs } from './reveal.js';
import { planReply } from './layout.js';

/** Friendly reply for an oracle failure. Ported from main.rs:773-790, "oracle.env" -> "Settings". */
export function oracleExcuse(e) {
  if (e.includes('no oracle')) {
    return 'The diary lies dormant: it found no oracle. Set an API key in Settings, then write again.';
  }
  if (e.startsWith('http 401') || e.startsWith('http 403')) {
    return "The oracle refused the diary's key. Check the API key in Settings.";
  }
  if (e.startsWith('http ')) {
    const code = e.split(':')[0];
    return `The oracle rejected the diary's plea (${code}). Check the model and endpoint in Settings.`;
  }
  if (e.includes('request failed') || e.includes('timed out')) {
    return 'The diary cannot reach its oracle. Is the tablet connected to Wi-Fi?';
  }
  if (e.includes('empty reply')) {
    return 'The spirit read your words but said nothing. Write again.';
  }
  return 'The ink blurred before it could answer. Write again.';
}

export function initialState() {
  return { name: 'listening' };
}

const R = (state, effects = []) => ({ state, effects });

/** Bounding-box union of two ink regions; either may be null. Pure. */
export function unionRegion(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Enter replying with the COMPLETE reply, revealed in one pass. The oracle
 * stream has already ended by the time we get here (the whole reply is buffered
 * first), so there is no append path and no stream/reveal race to track.
 */
function enterReplyingFull({ id, transcript = '', chunks, failed = false, extra = [] }) {
  const reply = chunks.join(' ').trim();
  return R(
    { name: 'replying', id, transcript, reply, totalPoints: 0, region: null, failed },
    [...extra, { type: 'write', text: reply }],
  );
}

/** Ink a friendly excuse as the reply; never persisted. */
function enterExcuse(id, rawError, extra = []) {
  const text = oracleExcuse(rawError);
  return R(
    { name: 'replying', id, transcript: '', reply: text, totalPoints: 0, region: null, failed: true },
    [...extra, { type: 'write', text }],
  );
}

/**
 * Stream ended: reveal the buffered reply, or ink an excuse. Keep the real ink
 * even if an error co-arrived — mark the turn failed (which suppresses the
 * memory persist) but do not replace the reply with an excuse. Ported from
 * riddle main.rs:577-581 (keep-ink + turn_failed).
 */
function resolveReply(s, extra = []) {
  if (s.chunks.length > 0) {
    return enterReplyingFull({ id: s.id, transcript: s.transcript || '', chunks: s.chunks, failed: s.error != null, extra });
  }
  if (s.error != null) return enterExcuse(s.id, s.error, extra);
  return enterExcuse(s.id, 'empty reply', extra);
}

/**
 * After the drink: reveal the reply if the stream already finished, otherwise
 * keep buffering while the thinking blot shows until the stream ends. Buffering
 * the whole reply lets the layout fit it to the screen before it is written.
 */
function afterDrink(s) {
  if (s.show != null) return R({ name: 'conjuring' }, [{ type: 'conjure', id: s.show }]);
  if (s.ended) return resolveReply(s);
  return R(
    { name: 'thinking', id: s.id, transcript: s.transcript || '', chunks: s.chunks, error: s.error },
    [{ type: 'blot', on: true }, { type: 'schedule', name: 'patience', ms: 120000 }],
  );
}

/** Complete the turn: persist when eligible, then linger. */
function toLingering(s) {
  const effects = [];
  if (!s.failed && s.reply !== '') {
    effects.push({ type: 'persist', id: s.id, transcript: s.transcript || '', reply: s.reply });
  }
  effects.push({ type: 'schedule', name: 'linger', ms: lingerMs(s.totalPoints) });
  return R({ name: 'lingering', region: s.region || null }, effects);
}

export function reduce(state, ev) {
  switch (state.name) {
    case 'listening':
      if (ev.type === 'commit') {
        return R(
          {
            name: 'drinking', id: ev.id, region: ev.region,
            chunks: [], show: null, error: null, transcript: null, ended: false,
          },
          [{ type: 'clearInk' }, { type: 'startOracle', uri: ev.uri }, { type: 'dissolve', region: ev.region, kind: 'drink' }],
        );
      }
      if (ev.type === 'help') return R({ name: 'help' }, [{ type: 'openHelp' }]);
      return R(state);

    case 'drinking':
      if (ev.type === 'oracleInk') return R({ ...state, chunks: [...state.chunks, ev.text] });
      if (ev.type === 'oracleShow') return R({ ...state, show: ev.id });
      if (ev.type === 'oracleTranscript') return R({ ...state, transcript: ev.text });
      if (ev.type === 'oracleError') return R({ ...state, error: ev.text });
      if (ev.type === 'oracleEnd') return R({ ...state, ended: true });
      if (ev.type === 'drinkDone') return afterDrink(state);
      return R(state);

    case 'thinking':
      if (ev.type === 'oracleShow') {
        return R({ name: 'conjuring' }, [{ type: 'blot', on: false }, { type: 'cancelTimer', name: 'patience' }, { type: 'conjure', id: ev.id }]);
      }
      // Buffer the reply as it streams; keep the blot up until the stream ends.
      if (ev.type === 'oracleInk') return R({ ...state, chunks: [...state.chunks, ev.text] });
      if (ev.type === 'oracleTranscript') return R({ ...state, transcript: ev.text });
      if (ev.type === 'oracleError') return R({ ...state, error: ev.text });
      if (ev.type === 'oracleEnd') {
        return resolveReply(state, [{ type: 'blot', on: false }, { type: 'cancelTimer', name: 'patience' }]);
      }
      if (ev.type === 'timer' && ev.name === 'patience') {
        return enterExcuse(state.id, 'timed out', [{ type: 'blot', on: false }]);
      }
      return R(state);

    case 'replying': {
      // The full reply is revealed in one pass (the stream already ended).
      if (ev.type === 'revealPlanned') {
        return R({
          ...state,
          totalPoints: state.totalPoints + ev.totalPoints,
          region: unionRegion(state.region, ev.region),
        });
      }
      if (ev.type === 'revealDrained') return toLingering(state);
      return R(state);
    }

    case 'lingering':
      if (ev.type === 'timer' && ev.name === 'linger') {
        return R({ name: 'fading', region: state.region }, [{ type: 'dissolve', region: state.region, kind: 'fade' }]);
      }
      if (ev.type === 'penTap') {
        return R({ name: 'fading', region: state.region }, [{ type: 'cancelTimer', name: 'linger' }, { type: 'dissolve', region: state.region, kind: 'fade' }]);
      }
      return R(state);

    case 'fading':
      if (ev.type === 'fadeDone') return R({ name: 'listening' }, [{ type: 'clearScreen' }]);
      return R(state);

    case 'help':
      if (ev.type === 'helpDismissed') return R({ name: 'listening' });
      return R(state);

    case 'conjuring':
      if (ev.type === 'conjureDrained') return R({ name: 'memory' }, [{ type: 'schedule', name: 'memory', ms: 120000 }]);
      if (ev.type === 'penTap') return R({ name: 'listening' }, [{ type: 'restoreCanvas' }]);
      return R(state);

    case 'memory':
      if (ev.type === 'penTap' || (ev.type === 'timer' && ev.name === 'memory')) {
        return R({ name: 'listening' }, [{ type: 'restoreCanvas' }]);
      }
      return R(state);

    default:
      return R(state);
  }
}

/** Stored [x,y,r] triples -> [x,y] polylines for the reveal animator. */
export function triplesToPolylines(strokes) {
  return strokes.map((s) => s.map(([x, y]) => [x, y]));
}

/**
 * Build the conjured page's combined stroke plan: date heading (centered at
 * headY), the writer's own strokes, then the old reply below. Ported from
 * conjure() (main.rs:795-857). Providers are injected so this stays pure.
 */
export function planConjure(headProvider, replyProvider, entry, { screenW, screenH, headY = 64 }) {
  const strokes = [];
  let x0b = Infinity, y0b = Infinity, x1b = -Infinity, y1b = -Infinity;
  const grow = (x, y) => {
    x0b = Math.min(x0b, x - 5); y0b = Math.min(y0b, y - 5);
    x1b = Math.max(x1b, x + 5); y1b = Math.max(y1b, y + 5);
  };
  let inkBottom = headY;

  // Heading: centered horizontally at headY.
  const head = headProvider.line(entry.dateText);
  const headX = Math.round((screenW - head.width) / 2);
  for (const s of head.strokes) {
    const mapped = s.map(([sx, sy]) => [headX + sx, headY + sy]);
    for (const [x, y] of mapped) { grow(x, y); inkBottom = Math.max(inkBottom, y); }
    strokes.push(mapped);
  }

  // The writer's own hand, exactly as penned.
  for (const s of triplesToPolylines(entry.strokes)) {
    for (const [x, y] of s) { grow(x, y); inkBottom = Math.max(inkBottom, y); }
    strokes.push(s);
  }

  // Tom's old reply, below.
  if (entry.reply && entry.reply.trim() !== '') {
    const yStart = Math.min(inkBottom + 130, screenH - 400);
    const plan = planReply(entry.reply, replyProvider, { screenW, screenH, yStart });
    for (const s of plan.strokes) {
      for (const [x, y] of s) grow(x, y);
      strokes.push(s);
    }
  }

  const region = strokes.length ? { x0: x0b, y0: y0b, x1: x1b, y1: y1b } : null;
  return { strokes, region };
}
