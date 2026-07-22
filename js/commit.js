// Idle-commit timing + commit geometry. Pure logic; renderCommitPng touches canvas.

/**
 * Ported from riddle main.rs: IDLE_COMMIT window measured from the last pen
 * sample, only counting while the pen is up.
 */
export function createIdleTimer(delayMs, onFire) {
  let handle = null;
  let down = false;
  const clear = () => { if (handle) { clearTimeout(handle); handle = null; } };
  const schedule = () => { clear(); if (!down) handle = setTimeout(onFire, delayMs); };
  return {
    activity() { schedule(); },
    penDown() { down = true; clear(); },
    penUp() { down = false; schedule(); },
    cancel() { clear(); },
  };
}

export function computeCommitBox(strokes, canvasW, canvasH, pad = 20) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      const r = p.r ?? 2;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    }
  }
  if (!Number.isFinite(x0)) return null;
  x0 = Math.max(0, Math.floor(x0) - pad);
  y0 = Math.max(0, Math.floor(y0) - pad);
  x1 = Math.min(canvasW, Math.ceil(x1) + pad);
  y1 = Math.min(canvasH, Math.ceil(y1) + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const factor = Math.max(Math.ceil(Math.max(w, h) / 800), 2);
  return { x0, y0, w, h, factor, outW: Math.round(w / factor), outH: Math.round(h / factor) };
}
