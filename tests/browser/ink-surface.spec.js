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
