import { test, expect } from '@playwright/test';

test('glyph cache rasterizes, thins, and traces real glyphs into polylines', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/glyphs-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const g = await page.evaluate(() => window.__glyphs);
  expect(g.lineHeight).toBe(120);
  expect(g.measure).toBeGreaterThan(0);
  expect(g.strokeCount).toBeGreaterThan(0);
  expect(g.totalPoints).toBeGreaterThan(20);
  expect(g.width).toBeGreaterThan(0);
  expect(g.cachedSameRef).toBe(true);
});
