import { test, expect } from '@playwright/test';

test('runDissolve maps a CSS-pixel region to device pixels on a dpr=2 canvas', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/dissolve-dpr-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const { before, after } = await page.evaluate(() => window.__dpr);
  expect(before).toBeGreaterThan(10000); // 160x160 device px filled
  expect(after).toBe(0);                 // fully dissolved to cream across the whole device region
});
