import { test, expect } from '@playwright/test';

test('corner hold opens settings; saving persists and closes', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Hold in the top-left corner (12% of 400px = ~48px).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });
  await expect(page.locator('.settings-panel')).toBeVisible({ timeout: 2000 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });

  await page.fill('input[name="key"]', 'sk-test');
  await page.fill('input[name="model"]', 'gpt-4o');
  await page.click('.settings-save');
  await expect(page.locator('.settings-panel')).toHaveCount(0);

  const saved = await page.evaluate(() => window.__saved);
  expect(saved.key).toBe('sk-test');
  expect(saved.model).toBe('gpt-4o');

  // Persisted: reopening loads the saved values.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 2 });
  await expect(page.locator('.settings-panel')).toBeVisible();
  await expect(page.locator('input[name="key"]')).toHaveValue('sk-test');
});
