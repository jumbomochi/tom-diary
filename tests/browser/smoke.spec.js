import { test, expect } from '@playwright/test';

test('page boots and canvas fills the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const box = await page.locator('#page').boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(100);
});
