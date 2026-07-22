import { test, expect } from '@playwright/test';

test('help panel shows adapted text and dismisses on pointer', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/help-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('.help-panel')).toBeVisible();
  await expect(page.locator('.help-panel')).toContainText('The Diary');
  await expect(page.locator('.help-panel')).toContainText('rest your quill');
  // web-adapted: no reMarkable-only lines
  await expect(page.locator('.help-panel')).not.toContainText('five fingers');
  await expect(page.locator('.help-panel')).not.toContainText('AppLoad');
  await page.mouse.click(10, 10);
  await expect(page.locator('.help-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dismissed)).toBe(1);
});
