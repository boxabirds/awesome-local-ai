import { expect, test } from '@playwright/test';
import { markerCentre, openBoard, settle, VIEWPORT } from './helpers/board';

/**
 * Touch drag (PRD "Pan": touch drag on mobile must behave like mouse drag). Playwright has
 * no touch-drag helper, so real touch events go through Chrome DevTools Protocol; that is
 * Chromium-only, and the other projects skip it.
 */
test.use({ hasTouch: true });

test.describe('touch drag panning', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'needs the CDP touch API');

  test('a touch drag moves the board by exactly the drag distance', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);
    const client = await page.context().newCDPSession(page);

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 300, y: 250 }],
    });
    for (const point of [
      { x: 350, y: 280 },
      { x: 400, y: 310 },
      { x: 450, y: 340 },
      { x: 500, y: 370 },
    ]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);

    const after = await markerCentre(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 120)).toBeLessThanOrEqual(1);
  });

  test('the page does not scroll while a touch drag pans the board', async ({ page }) => {
    await openBoard(page);
    const client = await page.context().newCDPSession(page);

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 640, y: 600 }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 640, y: 200 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);

    const scroll = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      scale: window.visualViewport?.scale ?? 1,
      viewportHeight: window.innerHeight,
    }));
    expect(scroll).toEqual({ x: 0, y: 0, scale: 1, viewportHeight: VIEWPORT.height });
  });
});
