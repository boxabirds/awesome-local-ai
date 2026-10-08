import { expect, type Page } from '@playwright/test';
import type { Camera, Point } from '../../../src/client/canvas/camera';

/**
 * The origin marker is a small world-space crosshair centred on (0,0); its
 * centre sits exactly at worldToScreen(0,0) = (-zoom * camera.x,
 * -zoom * camera.y), making it a stable pixel target for movement
 * assertions.
 */
export async function originPosition(page: Page): Promise<Point> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) {
    throw new Error('origin marker not found');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The current zoom percentage label (e.g. "100%"). */
export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label').textContent()) ?? '';
}

/** Let the rAF-coalesced camera update reach the DOM. */
export async function settle(page: Page, ms = 120): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Jump the camera directly via the test-only hook. The hook is present in
 * the e2e test build (`vite build --mode test`) and absent in production.
 */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => {
    const hook = window.__vidi6;
    if (!hook) {
      throw new Error('window.__vidi6 test hook is missing (not a test build?)');
    }
    hook.setCamera(c);
  }, cam);
  await settle(page);
}

/** The rendered dot grid tile size, e.g. "24px 24px" at zoom 1. */
export async function gridBackgroundSize(page: Page): Promise<string> {
  return page
    .getByTestId('board-viewport')
    .evaluate((el) => getComputedStyle(el).backgroundSize);
}

/** The rendered dot grid anchor (top-left of the first tile), in px. */
export async function gridBackgroundPosition(page: Page): Promise<Point> {
  const raw = await page
    .getByTestId('board-viewport')
    .evaluate((el) => getComputedStyle(el).backgroundPosition);
  const [x = 0, y = 0] = raw.split(' ').map((v) => parseFloat(v));
  return { x, y };
}

/** The page zoom state a zoom gesture must never change. */
export async function pageZoomState(
  page: Page,
): Promise<{ scale: number; devicePixelRatio: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

/** Assert two pixel positions agree within the e2e tolerance (±1 px). */
export function expectWithinPx(
  actual: number,
  expected: number,
  label: string,
  tolerancePx = 1,
): void {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected} ± ${tolerancePx}px`,
  ).toBeLessThanOrEqual(tolerancePx);
}
