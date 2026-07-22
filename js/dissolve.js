// Dither-dissolve: erase ink over N speckly stages. Pure pixel test + a
// canvas pass. Ported from riddle ink.rs dissolve_pass / px_hash.

export const DRINK_STAGES = 14;
export const DRINK_STEP_MS = 70;
export const FADE_STAGES = 10;
export const FADE_STEP_MS = 80;

/** Deterministic per-pixel hash (ink.rs px_hash), wrapping u32 arithmetic. */
export function pxHash(x, y) {
  let h = (Math.imul(x >>> 0, 0x9e3779b1) ^ Math.imul(y >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Whether pixel (x,y) has dissolved by `stage` of `stages`. */
export function shouldClear(x, y, stage, stages) {
  return pxHash(x, y) % stages <= stage;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Dissolve the ink in `region` back to `paper` over `stages`. Browser-only.
 * `region` is in CSS pixels (as the rest of the pipeline uses); this maps it
 * through the context transform to device pixels internally, because
 * getImageData/putImageData always operate in device pixels and ignore the 2D
 * transform (so on a DPR-scaled canvas the CSS region must be scaled up).
 */
export function runDissolve(ctx, region, {
  stages, stepMs, paper = '#f4ecd8', inkThreshold = 200, onDone,
} = {}) {
  const [pr, pg, pb] = hexToRgb(paper);
  const t = ctx.getTransform();
  const sx = t.a || 1, sy = t.d || 1; // device pixels per CSS pixel
  const dx0 = Math.max(0, Math.round(region.x0 * sx));
  const dy0 = Math.max(0, Math.round(region.y0 * sy));
  const w = Math.round((region.x1 - region.x0 + 1) * sx);
  const h = Math.round((region.y1 - region.y0 + 1) * sy);
  let stage = 0;
  let handle = null;

  const pass = () => {
    const img = ctx.getImageData(dx0, dy0, w, h);
    const d = img.data;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const o = (yy * w + xx) * 4;
        const luma = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
        if (luma < inkThreshold && shouldClear(dx0 + xx, dy0 + yy, stage, stages)) {
          d[o] = pr; d[o + 1] = pg; d[o + 2] = pb; d[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, dx0, dy0);
    stage++;
    if (stage >= stages) { handle = null; if (onDone) onDone(); }
    else handle = setTimeout(pass, stepMs);
  };

  handle = setTimeout(pass, stepMs);
  return { cancel() { if (handle) { clearTimeout(handle); handle = null; } } };
}
