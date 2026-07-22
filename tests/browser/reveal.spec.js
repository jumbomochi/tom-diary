import { test, expect } from '@playwright/test';

test('reveal animator draws black ink and fires onDone', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/reveal-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const r = await page.evaluate(() => window.__reveal);
  expect(r.done).toBe(true);
  // Midpoint pixel should be near-black (reply ink), not cream.
  expect(r.r).toBeLessThan(60);
  expect(r.g).toBeLessThan(60);
  expect(r.b).toBeLessThan(60);
});
