import { test, expect } from '@playwright/test';

// Reads the pixel at CSS (x,y) on the main canvas; returns [r,g,b,a].
async function pixelAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const c = document.getElementById('page');
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { x, y });
}

// Alpha MUST be checked: sampling a point outside a stale (un-resized) canvas
// backing store returns fully transparent [0,0,0,0] from getImageData, and
// `0 < 120` is true for r/g/b -- without the alpha check that transparent
// read false-positives as "ink" and lets a broken resize path slip through.
const isInk = ([r, g, b, a]) => a > 0 && r < 120 && g < 120 && b < 120; // sepia ink is dark-ish

// The core invariant the offset fix establishes: after any viewport change,
// the canvas backing store dimensions must track its CSS box at the current
// DPR. When resize handling is stale/broken, clientWidth/clientHeight change
// but canvas.width/height don't, and the browser visually stretches the
// stale backing store to fit the new CSS box (a *compositing* rescale that
// getImageData cannot see, since it reads the backing store directly). This
// helper asserts the one thing that actually breaks.
async function backingStoreDims(page, selector = '#page') {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    const dpr = window.devicePixelRatio || 1;
    return {
      w: c.width, expectW: Math.round(c.clientWidth * dpr),
      h: c.height, expectH: Math.round(c.clientHeight * dpr),
    };
  }, selector);
}

test('ink harness: __resize keeps the backing store honest and prior ink survives repaint', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/tests/browser/fixtures/ink-harness.html?idle=99999');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // First stroke at the original size.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 200, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });

  // Change the viewport, then re-run the app-level resize.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.evaluate(() => window.__resize());

  // Primary, meaningful assertion: the backing store now matches the new CSS
  // box exactly. This is what a stale/no-op resize handler actually breaks.
  const dims = await backingStoreDims(page);
  expect(dims.w, `canvas.width should be ${dims.expectW}, was ${dims.w}`).toBe(dims.expectW);
  expect(dims.h, `canvas.height should be ${dims.expectH}, was ${dims.h}`).toBe(dims.expectH);

  // With the backing store honestly resized, a correct resize() also repaints
  // committed strokes into the fresh store -- so finding ink here (alpha-
  // corrected) proves the repaint-on-resize path, not just the dimensions.
  expect(isInk(await pixelAt(page, 230, 200))).toBe(true);

  // A new stroke lands exactly under the pointer (no offset).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 150, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  // Give rAF a frame to paint the live stroke, then bake happens on pointerup.
  await page.waitForTimeout(50);
  expect(isInk(await pixelAt(page, 180, 400))).toBe(true);
});

test('real app: app-boot debounced resize listener auto re-syncs the canvas backing store', async ({ page }) => {
  // Loads index.html -> js/app-boot.js for real, so the debounced
  // resize/visualViewport/orientationchange listeners app-boot.js wires up
  // are live -- unlike tests/browser/fixtures/app-harness.html, which imports
  // initApp() directly and never registers those listeners at all.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Sanity baseline: right after boot, sizeCanvasBacking() already matched
  // the backing store to the CSS box.
  const before = await backingStoreDims(page);
  expect(before.w).toBe(before.expectW);
  expect(before.h).toBe(before.expectH);

  // Draw on the real canvas. (On first launch there's no saved key, so
  // Settings opens automatically -- but dispatchEvent targets #page directly
  // regardless of any overlay, and this test only asserts dimensions below,
  // not committed ink, so that doesn't matter.) There is no window.__app on
  // '/', so drive input via raw pointer events.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 200, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 260, clientY: 200, pointerType: 'pen', pressure: 0.6, pointerId: 1, isPrimary: true });

  // No manual resize hook here -- that's the point: the real, debounced
  // listener must fire on its own.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(250); // app-boot debounces resize at 100ms; leave headroom

  const after = await backingStoreDims(page);
  expect(after.w, `canvas.width should track the resize: expected ${after.expectW}, got ${after.w}`).toBe(after.expectW);
  expect(after.h, `canvas.height should track the resize: expected ${after.expectH}, got ${after.h}`).toBe(after.expectH);
});
