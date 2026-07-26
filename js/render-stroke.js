// Shared calligraphic stroke renderer. Wraps perfect-freehand's getStroke to
// turn a stroke's input points into a filled, variable-width outline. Used by
// the on-screen ink (ink.js) and the committed PNG (commit.js) so both look
// identical.
import { getStroke } from '../vendor/perfect-freehand.mjs';

const INK = '#33302a';

// Tuned for the diary's ink weight on cream paper. `size` is the nib diameter
// in CSS px; `thinning` sets how strongly pressure/velocity vary the width.
export const STROKE_OPTIONS = {
  size: 7,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.4,
  easing: (t) => t,
};

/**
 * Pure: input points -> closed outline polygon (array of [x, y]).
 * `points` are {x, y, pressure}. `simulatePressure` derives width from velocity
 * when there is no real pen pressure (finger/mouse). `last` closes the tail
 * taper for a completed stroke.
 */
export function strokeOutline(points, { simulatePressure = true, last = false } = {}) {
  const input = points.map((p) => [p.x, p.y, p.pressure ?? 0.5]);
  return getStroke(input, { ...STROKE_OPTIONS, simulatePressure, last });
}

/** Fill one stroke's calligraphic outline onto ctx. Color defaults to INK. */
export function renderStroke(ctx, points, opts = {}) {
  if (!points || points.length === 0) return;
  const outline = strokeOutline(points, opts);
  if (outline.length < 2) return;
  ctx.fillStyle = opts.color || INK;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
  ctx.closePath();
  ctx.fill();
}
