import { test, expect } from '@playwright/test';

async function penStroke(page, pts) {
  await page.dispatchEvent('#page', 'pointerdown', { clientX: pts[0].x, clientY: pts[0].y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
  for (const p of pts.slice(1)) await page.dispatchEvent('#page', 'pointermove', { clientX: p.x, clientY: p.y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: pts.at(-1).x, clientY: pts.at(-1).y, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
}

test('write -> drink -> reply -> linger -> fade returns to a listening blank page', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() => {
    const S = '⁂'; // ⁂
    window.__sse = () => [
      'data: {"choices":[{"delta":{"content":"Hello. "}}]}\n',
      'data: {"choices":[{"delta":{"content":"Who writes to me? "}}]}\n',
      `data: {"choices":[{"delta":{"content":"${S} it rained all night"}}]}\n`,
      'data: [DONE]\n',
    ];
  });

  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);

  // The reply is inked (black pixels appear), then the turn is remembered.
  await page.waitForFunction(() => window.__app.getState().name === 'replying' || window.__app.getState().name === 'lingering', null, { timeout: 5000 });
  await expect.poll(() => page.evaluate(() => window.__inkPixels()), { timeout: 5000 }).toBeGreaterThan(200);

  // Wait for the reply to finish and linger.
  await page.waitForFunction(() => window.__app.getState().name === 'lingering', null, { timeout: 8000 });
  const remembered = await page.evaluate(async () => (await window.__memory.all()).map((e) => e.transcript));
  expect(remembered).toContain('it rained all night');

  // Tap to fade early, then it dissolves back to a blank listening page.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 50, clientY: 50, pointerType: 'pen', isPrimary: true, pointerId: 2 });
  await page.waitForFunction(() => window.__app.getState().name === 'listening', null, { timeout: 5000 });
});

test('a leading show:N conjures a seeded memory and returns on a tap', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Seed one earlier page so the catalog has an entry (⟦show:1⟧ -> it).
  await page.evaluate(async () => {
    await window.__memory.append(1751856000, 'about the rain', 'The ink blurred, but I felt it.', [{ points: [{ x: 120, y: 300, r: 3 }, { x: 220, y: 360, r: 2 }] }]);
    const O = '⟦', C = '⟧', S = '⁂';
    window.__sse = () => [
      `data: {"choices":[{"delta":{"content":"${O}show:1${C}"}}]}\n`,
      `data: {"choices":[{"delta":{"content":"\\n${S} show me the rain page"}}]}\n`,
      'data: [DONE]\n',
    ];
  });

  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);

  await page.waitForFunction(() => window.__app.getState().name === 'conjuring' || window.__app.getState().name === 'memory', null, { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.__inkPixels()), { timeout: 8000 }).toBeGreaterThan(50);
  await page.waitForFunction(() => window.__app.getState().name === 'memory', null, { timeout: 8000 });

  // A pen tap returns to today's (blank) page.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 50, clientY: 50, pointerType: 'pen', isPrimary: true, pointerId: 3 });
  await page.waitForFunction(() => window.__app.getState().name === 'listening', null, { timeout: 5000 });
});

test('a multi-chunk streamed reply threads its full region so the fade clears it to a blank page', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Two ink chunks (each a complete sentence), so the driver's first effect is
  // 'write' and the second is 'append' (js/app.js's runEffect + handwriting.js's
  // createReplyWriter). Guards the region-threading fix (commit 49ca177): the
  // reducer's 'replying' -> revealPlanned handler must union() the append's
  // region into state.region (js/statemachine.js unionRegion), not just keep
  // the first write's box, or 'lingering'/'fading' would dissolve only part of
  // the ink.
  await page.evaluate(() => {
    const S = '⁂'; // ⁂
    window.__sse = () => [
      'data: {"choices":[{"delta":{"content":"The storm kept me from sleeping. "}}]}\n',
      'data: {"choices":[{"delta":{"content":"I listened to it drum on the roof all night long. "}}]}\n',
      `data: {"choices":[{"delta":{"content":"${S} a stormy night"}}]}\n`,
      'data: [DONE]\n',
    ];
  });

  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);

  await page.waitForFunction(() => window.__app.getState().name === 'lingering', null, { timeout: 8000 });

  // The reducer accumulated a non-null, non-degenerate region across both the
  // 'write' and 'append' effects.
  const region = await page.evaluate(() => window.__app.getState().region);
  expect(region).toBeTruthy();
  expect(region.x1).toBeGreaterThan(region.x0);
  expect(region.y1).toBeGreaterThan(region.y0);

  // Almost all of the canvas's ink (the two-sentence reply; the writer's own
  // commit ink already dissolved away during 'drinking') falls inside that
  // threaded region -- i.e. the region truly covers BOTH chunks, not just the
  // first write()'s box.
  const totalInk = await page.evaluate(() => window.__inkPixels());
  expect(totalInk).toBeGreaterThan(200);
  const inRegionBefore = await page.evaluate((r) => window.__inkPixelsIn(r), region);
  expect(inRegionBefore).toBeGreaterThanOrEqual(Math.floor(totalInk * 0.9));

  // Tap to fade early; the FadingReply dissolve runs over exactly that region.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 50, clientY: 50, pointerType: 'pen', isPrimary: true, pointerId: 4 });
  await page.waitForFunction(() => window.__app.getState().name === 'listening', null, { timeout: 5000 });

  // After the fade completes, the same region -- where nearly all the reply's
  // ink lived -- is back to blank cream: no ink pixels remain in it.
  const inRegionAfter = await page.evaluate((r) => window.__inkPixelsIn(r), region);
  expect(inRegionAfter).toBe(0);
});

test('opening Settings via a corner-hold suppresses ink: no hold-dot lingers and no junk page commits behind the panel', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Press-and-hold in the top-left corner (12% of 800x600 => x<=96, y<=72).
  // The hold-dot is drawn by ink's pointerdown BEFORE the 150ms hold completes.
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 20, clientY: 20, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 1 });
  await expect(page.locator('.settings-panel')).toBeVisible({ timeout: 2000 });

  // (a) Opening the panel erased the transient hold-dot: the corner is blank cream.
  const cornerInk = await page.evaluate(() => window.__inkPixelsIn({ x0: 0, y0: 0, x1: 120, y1: 100 }));
  expect(cornerInk).toBe(0);

  // Release the hold pen, then try to draw a full stroke across the canvas while
  // the panel is open. The gate must reject it (state stays 'listening', but
  // settingsOpen is true), so nothing is recorded.
  await page.dispatchEvent('#page', 'pointerup', { clientX: 20, clientY: 20, pointerType: 'pen', isPrimary: true, pointerId: 1 });
  await page.dispatchEvent('#page', 'pointerdown', { clientX: 300, clientY: 300, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 5 });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 360, clientY: 320, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 5 });
  await page.dispatchEvent('#page', 'pointermove', { clientX: 420, clientY: 340, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 5 });
  await page.dispatchEvent('#page', 'pointerup', { clientX: 420, clientY: 340, pointerType: 'pen', pressure: 0.6, isPrimary: true, pointerId: 5 });
  expect(await page.evaluate(() => window.__app.store.strokes.length)).toBe(0);

  // Close the panel (submit) -> ink resumes.
  await page.click('.settings-save');
  await expect(page.locator('.settings-panel')).toHaveCount(0);

  // Well past the (200ms) idle window: no oracle turn ever fired and no page was
  // persisted -- neither for the hold-dot nor the blocked stroke.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__fetchCount)).toBe(0);
  expect(await page.evaluate(async () => (await window.__memory.all()).length)).toBe(0);
});

test('opening then closing Settings resets the offscreen ink layer: no ghost of the pre-open stroke reappears', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-settings-harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  // Draw a stroke well outside the corner-hold zone, before Settings is ever opened.
  const firstRegion = { x0: 190, y0: 190, x1: 410, y1: 220 };
  await penStroke(page, [{ x: 200, y: 200 }, { x: 300, y: 210 }, { x: 400, y: 205 }]);
  await expect.poll(() => page.evaluate((r) => window.__inkPixelsIn(r), firstRegion)).toBeGreaterThan(0);

  // Open Settings, then close it -- directly via the app API (app.js's
  // setSettingsOpen), same call the corner-hold gesture drives in production.
  // `open` must clear both the stroke store AND the offscreen layer (ink.js's
  // clearInk()), not just the store, or the layer's stale pixels reappear on
  // the very next blit().
  await page.evaluate(() => window.__app.setSettingsOpen(true));
  await page.evaluate(() => window.__app.setSettingsOpen(false));

  // Draw a second, short stroke in a different region.
  const secondRegion = { x0: 490, y0: 440, x1: 550, y1: 470 };
  await penStroke(page, [{ x: 500, y: 450 }, { x: 540, y: 460 }]);
  await expect.poll(() => page.evaluate((r) => window.__inkPixelsIn(r), secondRegion)).toBeGreaterThan(0);

  // No ghost: the first stroke's region is back to blank paper even after the
  // next blit() composited the (reset) offscreen layer under the new stroke.
  expect(await page.evaluate((r) => window.__inkPixelsIn(r), firstRegion)).toBe(0);
});
