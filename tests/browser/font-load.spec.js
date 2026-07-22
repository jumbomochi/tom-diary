import { test, expect } from '@playwright/test';

test('DancingScript parses via vendored opentype and exposes metrics', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/font-harness.html');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const f = await page.evaluate(() => window.__font);
  expect(f.unitsPerEm).toBeGreaterThan(0);
  expect(f.advance).toBeGreaterThan(0);
  expect(f.ok).toBe(true);
});
