import { test, expect } from '@playwright/test';

async function penStroke(page, pts) {
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
  for (const p of pts.slice(1)) await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType: 'pen', pressure: 0.5, isPrimary: true, pointerId: 1 });
}

test('gate blocks ink and reports a tap when not accepting', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/gate-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => { window.__accept = false; });
  await penStroke(page, [{ x: 100, y: 100 }, { x: 160, y: 120 }]);
  expect(await page.evaluate(() => window.__strokeCount())).toBe(0);
  expect(await page.evaluate(() => window.__taps)).toBe(1);

  await page.evaluate(() => { window.__accept = true; });
  await penStroke(page, [{ x: 100, y: 100 }, { x: 160, y: 120 }, { x: 220, y: 110 }]);
  expect(await page.evaluate(() => window.__strokeCount())).toBe(1);
});
