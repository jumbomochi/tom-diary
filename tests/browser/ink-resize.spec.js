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

const isInk = ([r, g, b]) => r < 120 && g < 120 && b < 120; // sepia ink is dark-ish

test('ink lands under the pointer after a viewport resize', async ({ page }) => {
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

  // The earlier stroke survives the resize.
  expect(isInk(await pixelAt(page, 230, 200))).toBe(true);

  // A new stroke lands exactly under the pointer (no offset).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 150, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 210, clientY: 400, pointerType: 'pen', pressure: 0.6, pointerId: 2, isPrimary: true });
  // Give rAF a frame to paint the live stroke, then bake happens on pointerup.
  await page.waitForTimeout(50);
  expect(isInk(await pixelAt(page, 180, 400))).toBe(true);
});
