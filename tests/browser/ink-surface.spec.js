import { test, expect } from '@playwright/test';

async function stroke(page, pts, { pointerType = 'pen', pressure = 0.5 } = {}) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType, pressure, isPrimary: true });
  for (const p of pts.slice(1)) {
    await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType, pressure, isPrimary: true });
  }
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType, pressure, isPrimary: true });
}

test('writing then resting fires a commit with a PNG', async ({ page }) => {
  await page.goto('/?idle=300'); // short idle for the test
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await stroke(page, [{ x: 200, y: 200 }, { x: 260, y: 210 }, { x: 320, y: 205 }]);
  await page.waitForFunction(() => window.__lastCommit != null, null, { timeout: 3000 });
  const uri = await page.evaluate(() => window.__lastCommit);
  expect(uri.startsWith('data:image/png;base64,')).toBe(true);
});

test('a large "!" opens the help panel instead of committing', async ({ page }) => {
  await page.goto('/?idle=300');
  const h = await page.evaluate(() => window.innerHeight);
  const barTop = h * 0.2, barBottom = h * 0.55;
  const bar = Array.from({ length: 20 }, (_, i) => ({ x: 400, y: barTop + (i * (barBottom - barTop)) / 19 }));
  await stroke(page, bar);
  const dot = [{ x: 400, y: barBottom + 40 }, { x: 402, y: barBottom + 43 }, { x: 400, y: barBottom + 46 }];
  await stroke(page, dot);
  await expect(page.locator('.help-panel')).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => window.__lastCommit)).toBeUndefined();
});

test('pointercancel does not wedge the idle-commit loop', async ({ page }) => {
  await page.goto('/?idle=300');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Start a stroke, move a couple of times, then cancel it (no pointerup).
  const pointerType = 'pen', pressure = 0.5, pointerId = 11;
  await page.mouse.move(100, 100);
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 100, clientY: 100, pointerType, pressure, pointerId, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 110, clientY: 105, pointerType, pressure, pointerId, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 120, clientY: 110, pointerType, pressure, pointerId, isPrimary: true });
  await page.dispatchEvent('#page', 'pointercancel', { clientX: 120, clientY: 110, pointerType, pressure, pointerId, isPrimary: true });

  // Without the fix, penDown stays true forever and this next stroke's
  // pointerdown/pointermove/pointerup would be ignored or state would be corrupt.
  await stroke(page, [{ x: 200, y: 200 }, { x: 260, y: 210 }, { x: 320, y: 205 }]);
  await page.waitForFunction(() => window.__lastCommit != null, null, { timeout: 3000 });
  const uri = await page.evaluate(() => window.__lastCommit);
  expect(uri.startsWith('data:image/png;base64,')).toBe(true);
});

test('a concurrent second pointer does not corrupt the active stroke', async ({ page }) => {
  await page.goto('/?idle=99999'); // no idle commit interference
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  const pointerType = 'pen', pressure = 0.5;
  // Pointer A begins a stroke.
  await page.mouse.move(150, 150);
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 150, clientY: 150, pointerType, pressure, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 160, clientY: 155, pointerType, pressure, pointerId: 1, isPrimary: true });

  // A concurrent pointer B shows up mid-stroke and should be entirely ignored.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 400, clientY: 400, pointerType, pressure, pointerId: 2, isPrimary: false });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 410, clientY: 405, pointerType, pressure, pointerId: 2, isPrimary: false });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 410, clientY: 405, pointerType, pressure, pointerId: 2, isPrimary: false });

  // Pointer A continues and completes normally.
  await page.dispatchEvent('#page', 'pointermove', { clientX: 170, clientY: 160, pointerType, pressure, pointerId: 1, isPrimary: true });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 170, clientY: 160, pointerType, pressure, pointerId: 1, isPrimary: true });

  const count = await page.evaluate(() => window.__ink.store.strokes.length);
  expect(count).toBe(1);
});
