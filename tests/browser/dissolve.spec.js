import { test, expect } from '@playwright/test';

test('runDissolve clears all ink to paper over its stages', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/dissolve-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const before = await page.evaluate(() => window.__before);
  const after = await page.evaluate(() => window.__after);
  expect(before).toBeGreaterThan(5000); // ~80x80 filled
  expect(after).toBe(0);                 // fully dissolved to cream
});
