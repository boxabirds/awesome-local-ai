// Shared Playwright helpers for board navigation e2e tests.

import { expect, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
    };
  }
}

export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('origin-marker').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

/**
 * Jump the camera to an exact position/zoom via the test-mode hook, then
 * wait for the render to settle: the origin marker lands at the screen
 * position (-x*zoom, -y*zoom).
 */
export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => window.__vidi6?.setCamera(cx, cy, cz),
    [x, y, zoom],
  );
  await expect
    .poll(async () => {
      const c = await originMarkerCenter(page);
      return [c.x, c.y];
    })
    .toEqual([-x * zoom, -y * zoom]);
}

/** Computed dot-grid spacing in CSS pixels (expected: GRID_SPACING_WORLD * zoom). */
export async function gridSpacingPx(page: Page): Promise<string> {
  return page.getByTestId('board-viewport').evaluate((el) => getComputedStyle(el).backgroundSize);
}

export { GRID_SPACING_WORLD };
