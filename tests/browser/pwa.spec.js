import { test, expect } from '@playwright/test';

test('manifest is linked and the service worker registers + precaches the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  }, null, { timeout: 10000 });

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return [];
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return reqs.map((r) => new URL(r.url).pathname);
  });
  expect(cached.some((p) => p.endsWith('/js/statemachine.js') || p.endsWith('/js/oracle.js'))).toBe(true);
  expect(cached.some((p) => p.endsWith('/fonts/DancingScript.ttf'))).toBe(true);
});
