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

  const dims = () => ({ screenW: canvas.clientWidth, screenH: canvas.clientHeight });

  return {
    write(text, { onDone } = {}) {
      // The full reply is planned in one pass (fit-to-height + centered).
      const plan = planReply(text, provider, { ...dims(), marginX, yStart: null });
      if (this._active) this._active.stop();
      const a = createRevealAnimator(ctx, { color, onDone });
      a.setPlan(plan.strokes);
      a.start();
      this._active = a;
      return { region: plan.region, totalPoints: plan.totalPoints, lingerMs: lingerMs(plan.totalPoints) };
    },
    stop() { if (this._active) this._active.stop(); },
  };
}
