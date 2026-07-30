// Browser wiring: opentype.js glyph outlines + offscreen-canvas rasterization
// + skeleton.js, exposed as the layout provider planReply consumes.
import { thinZhangSuen, traceSkeleton, smoothPolyline, smoothPolylineTaubin } from './skeleton.js';

// Default reply-stroke smoothing: Taubin λ|μ (shape-preserving low-pass) removes
// the skeleton's residual wobble without shrinking the letterforms.
export const DEFAULT_SMOOTH = { method: 'taubin', iters: 20, lambda: 0.5, mu: -0.53 };

/** Smooth one traced skeleton stroke per the smoothing config. */
function smoothStroke(stroke, smooth) {
  if (!smooth || smooth.method === 'none') return stroke.map((p) => [p[0], p[1]]);
  if (smooth.method === 'box') return smoothPolyline(stroke, smooth);
  return smoothPolylineTaubin(stroke, smooth);
}

export async function loadFont(url) {
  const opentype = await import('../vendor/opentype.mjs');
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  return opentype.parse(buf);
}

const INK_THRESHOLD = 128; // glyph drawn black-on-white offscreen; ink if luma < this

/** Rasterize one glyph into the shared line box and trace its skeleton. */
function traceGlyph(font, char, px, lineH, ascent, advance, smooth) {
  const glyph = font.charToGlyph(char);
  const boxW = Math.max(1, Math.ceil(advance) + 4);
  const canvas = document.createElement('canvas');
  canvas.width = boxW;
  canvas.height = lineH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, boxW, lineH);
  ctx.fillStyle = '#000000';
  // opentype getPath: x/y is the pen origin; baseline at y = ascent.
  const path = glyph.getPath(2, ascent, px);
  path.fill = '#000000';
  path.draw(ctx);
  const data = ctx.getImageData(0, 0, boxW, lineH).data;
  const mask = new Uint8Array(boxW * lineH);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    if (luma < INK_THRESHOLD) mask[i] = 1;
  }
  thinZhangSuen(mask, boxW, lineH);
  // Smooth the pixel-grid skeleton to sub-pixel curves so the reveal's stroke
  // stamping follows clean paths instead of the ±1px thinning staircase and its
  // residual wobble. Point count is preserved, so reveal timing is unchanged.
  const strokes = traceSkeleton(mask, boxW, lineH).map((s) => smoothStroke(s, smooth));
  return { advance, strokes };
}

export function createGlyphCache(font, px = 96, smooth = DEFAULT_SMOOTH) {
  const lineHeight = Math.floor(px * 1.25);
  const scale = px / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const metrics = new Map(); // char -> advance (px), no rasterization
  const cache = new Map(); // char -> { advance, strokes }
  // Metrics-only path: advance width in px, no canvas/rasterization.
  const advanceOf = (char) => {
    let a = metrics.get(char);
    if (a === undefined) {
      a = font.charToGlyph(char).advanceWidth * scale;
      metrics.set(char, a);
    }
    return a;
  };
  // Raster path: trace skeleton, reusing the metrics advance so line().width
  // and measure() agree exactly.
  const glyphOf = (char) => {
    let g = cache.get(char);
    if (!g) {
      g = traceGlyph(font, char, px, lineHeight, ascent, advanceOf(char), smooth);
      cache.set(char, g);
    }
    return g;
  };
  const kern = (a, b) =>
    font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)) * scale;

  const measure = (str) => {
    let caret = 0;
    for (let i = 0; i < str.length; i++) {
      if (i > 0) caret += kern(str[i - 1], str[i]);
      caret += advanceOf(str[i]);
    }
    return caret;
  };

  const line = (str) => {
    let caret = 0;
    const strokes = [];
    for (let i = 0; i < str.length; i++) {
      if (i > 0) caret += kern(str[i - 1], str[i]);
      const g = glyphOf(str[i]);
      for (const s of g.strokes) strokes.push(s.map(([x, y]) => [x + Math.round(caret), y]));
      caret += g.advance;
    }
    return { width: caret, strokes };
  };

  return { measure, line, lineHeight, space: advanceOf(' ') };
}
