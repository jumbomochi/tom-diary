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

test('committed PNG is black ink on white paper', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/commit-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const result = await page.evaluate(async () => {
    const strokes = [{ points: [
      { x: 100, y: 100, r: 4 }, { x: 200, y: 100, r: 4 }, { x: 300, y: 100, r: 4 },
    ] }];
    const { uri } = window.runCommit(strokes, 1000, 1000);
    const img = new Image();
    img.src = uri;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const isWhiteish = (r, g, b) => r > 240 && g > 240 && b > 240;
    const isDark = (r, g, b) => r < 40 && g < 40 && b < 40;

    const cornerWhite = isWhiteish(data[0], data[1], data[2]);
    let hasDarkPixel = false;
    for (let i = 0; i < data.length; i += 4) {
      if (isDark(data[i], data[i + 1], data[i + 2])) { hasDarkPixel = true; break; }
    }
    return { cornerWhite, hasDarkPixel };
  });
  expect(result.cornerWhite).toBe(true);
  expect(result.hasDarkPixel).toBe(true);
});
