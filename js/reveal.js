// Stroke-by-stroke handwriting reveal. Pure stepping + linger math; the
// animator and brush touch the canvas. Ported from riddle main.rs Replying.

/** Round hard-edged stamp (port of surface.stamp — filled disc, radius r). */
export function stampDot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Stamp along a line (port of surface.brush_line). */
export function brushLine(ctx, x0, y0, x1, y1, r, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    stampDot(ctx, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r, color);
  }
}

/**
 * Advance the reveal by up to `budget` points across strokes, from `cursor`.
 * Returns the draw ops (stamp when `from` is null, else a segment from the
 * previous point) and the new cursor. (main.rs:589-609)
 */
export function stepReveal(cursor, strokes, budget) {
  let { strokeI, pointI } = cursor;
  const ops = [];
  let left = budget;
  while (left > 0 && strokeI < strokes.length) {
    const stroke = strokes[strokeI];
    if (pointI >= stroke.length) { strokeI++; pointI = 0; continue; }
    const [x, y] = stroke[pointI];
    ops.push({ x, y, from: pointI > 0 ? stroke[pointI - 1] : null });
    pointI++;
    left--;
  }
  return { ops, cursor: { strokeI, pointI }, done: strokeI >= strokes.length };
}

/** Linger duration: rest the finished reply before fading. (main.rs:628-630) */
export function lingerMs(totalPoints) {
  return Math.min(4000 + totalPoints * 2, 20000);
}

/** Browser animator: reveal `pointsPerTick` points every `tickMs`. */
export function createRevealAnimator(ctx, {
  pointsPerTick = 26, tickMs = 14, radius = 2, color = '#000000', onDone,
} = {}) {
  let strokes = [];
  let cursor = { strokeI: 0, pointI: 0 };
  let handle = null;

  const draw = (op) => {
    if (op.from) brushLine(ctx, op.from[0], op.from[1], op.x, op.y, radius, color);
    else stampDot(ctx, op.x, op.y, radius, color);
  };

  const tick = () => {
    const { ops, cursor: next, done } = stepReveal(cursor, strokes, pointsPerTick);
    for (const op of ops) draw(op);
    cursor = next;
    // "done" here means the current queue is drained; append() can extend it.
    if (done) { handle = null; if (onDone) onDone(); }
    else handle = setTimeout(tick, tickMs);
  };

  return {
    setPlan(s) { strokes = s.slice(); cursor = { strokeI: 0, pointI: 0 }; },
    append(s) { strokes = strokes.concat(s); if (!handle) handle = setTimeout(tick, tickMs); },
    start() { if (!handle) handle = setTimeout(tick, tickMs); },
    stop() { if (handle) { clearTimeout(handle); handle = null; } },
  };
}
