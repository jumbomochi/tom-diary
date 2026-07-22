import { test, expect } from '@playwright/test';

test('renderCommitPng returns a PNG data URI with black ink on white', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/commit-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const result = await page.evaluate(() => {
    const strokes = [{ points: [
      { x: 100, y: 100, r: 3 }, { x: 200, y: 100, r: 3 }, { x: 300, y: 100, r: 3 },
    ] }];
    const { box, uri } = window.runCommit(strokes, 1000, 1000);
    return { uri, outW: box.outW, outH: box.outH };
  });
  expect(result.uri.startsWith('data:image/png;base64,')).toBe(true);
  expect(result.outW).toBeGreaterThan(0);
  expect(result.outH).toBeGreaterThan(0);
});
