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
