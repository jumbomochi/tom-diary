// Public facade: turn reply text into Tom's animated handwriting on a canvas.
// Composes the glyph cache, layout, and reveal. Plan 4's state machine calls
// createReplyWriter(); runDissolve is re-exported for its Drinking/Fading states.
import { createGlyphCache } from './glyphs.js';
import { planReply } from './layout.js';
import { createRevealAnimator, lingerMs } from './reveal.js';

export { loadFont } from './glyphs.js';
export { runDissolve, DRINK_STAGES, DRINK_STEP_MS, FADE_STAGES, FADE_STEP_MS } from './dissolve.js';
export { lingerMs } from './reveal.js';

export function createReplyWriter(canvas, font, { px = 96, marginX = 120, color = '#000000', smooth } = {}) {
  const ctx = canvas.getContext('2d');
  const provider = createGlyphCache(font, px, smooth);
  let nextY = null;

  const dims = () => ({ screenW: canvas.clientWidth, screenH: canvas.clientHeight });

  return {
    write(text, { onDone } = {}) {
      const plan = planReply(text, provider, { ...dims(), marginX, yStart: null });
      nextY = plan.nextY;
      // Each reveal gets its own animator so its onDone is per-call; the
      // animator's onDone is fixed at construction (Task 8).
      if (this._active) this._active.stop();
      const a = createRevealAnimator(ctx, { color, onDone });
      a.setPlan(plan.strokes);
      a.start();
      this._active = a;
      return { region: plan.region, totalPoints: plan.totalPoints, lingerMs: lingerMs(plan.totalPoints) };
    },
    appendChunk(text) {
      const plan = planReply(text, provider, { ...dims(), marginX, yStart: nextY });
      nextY = plan.nextY;
      if (this._active) this._active.append(plan.strokes);
      return { region: plan.region, totalPoints: plan.totalPoints };
    },
    stop() { if (this._active) this._active.stop(); },
  };
}
