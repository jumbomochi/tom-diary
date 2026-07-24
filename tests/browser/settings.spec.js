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

test('moving out of the corner before the hold elapses cancels the open', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Press in the corner, then move to the canvas center (outside the corner) before holdMs (120ms).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 200, clientY: 200, pointerType: 'pen', isPrimary: true, pointerId: 1 });

  // Wait well past holdMs; the panel must never appear.
  await page.waitForTimeout(300);
  await expect(page.locator('.settings-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__opened)).toBe(0);
});

test('releasing before the hold elapses cancels the open', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Press in the corner, then release before holdMs (120ms).
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 10, clientY: 10, pointerType: 'pen', isPrimary: true, pointerId: 1 });

  // Wait well past holdMs; the panel must never appear.
  await page.waitForTimeout(300);
  await expect(page.locator('.settings-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__opened)).toBe(0);
});
