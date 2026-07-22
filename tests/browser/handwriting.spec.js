import { test, expect } from '@playwright/test';

test('createReplyWriter writes a reply as black ink and reports its plan', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/handwriting-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 15000 });
  const hw = await page.evaluate(() => window.__hw);
  expect(hw.totalPoints).toBeGreaterThan(100);
  expect(hw.ink).toBeGreaterThan(200);          // real ink landed on the page
  expect(hw.linger).toBe(Math.min(4000 + hw.totalPoints * 2, 20000));
});
