import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const ORIGIN_MARKER = '[data-testid="origin-marker"]';
export const WORLD_LAYER = '[data-testid="world-layer"]';
export const VIEWPORT = '[data-testid="board-viewport"]';
export const ZOOM_LABEL = '[data-testid="zoom-label"]';
export const NAV_HINT = '[data-testid="navigation-hint"]';

/** Screen-space centre of the origin marker (world (0,0)). */
export async function originCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(ORIGIN_MARKER).boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Current zoom label text, e.g. "100%". */
export async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator(ZOOM_LABEL).textContent()) ?? '';
}

/** Jump the camera via the test-mode hook (test build only). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((cam) => {
    if (!window.__vidi6) throw new Error('window.__vidi6 not available (test build required)');
    window.__vidi6.setCamera(cam);
  }, camera);
}

/** Parsed dot grid background: tile size and position in CSS pixels. */
export async function gridBackground(
  page: Page,
): Promise<{ sizeX: number; sizeY: number; posX: number; posY: number }> {
  return page.locator(VIEWPORT).evaluate((el) => {
    const s = getComputedStyle(el);
    const [sizeX, sizeY] = s.backgroundSize.split(' ').map(parseFloat);
    const [posX, posY] = s.backgroundPosition.split(' ').map(parseFloat);
    return { sizeX, sizeY, posX, posY };
  });
}

/**
 * Poll the origin marker until its centre is within `tolerance` px of
 * (x, y). Resolves once true; fails the test if it never does.
 */
export async function expectCenterWithin(
  page: Page,
  x: number,
  y: number,
  tolerance = 1,
  timeout = 5000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const c = await originCenter(page);
        if (Math.abs(c.x - x) > tolerance || Math.abs(c.y - y) > tolerance) {
          throw new Error(
            `origin centre at (${c.x}, ${c.y}) is more than ${tolerance}px from (${x}, ${y})`,
          );
        }
        return true;
      },
      { timeout, message: `origin centre within ${tolerance}px of (${x}, ${y})` },
    )
    .toBe(true);
}

/** The browser's page zoom, which board gestures must never change. */
export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}
