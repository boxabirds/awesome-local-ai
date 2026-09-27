// Shared Playwright helpers for board navigation e2e tests.

import { expect, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(x: number, y: number, zoom: number): void;
      createSticky(x: number, y: number, color?: string): string | null;
      getStickyNotes(): Array<{ id: string; x: number; y: number; color: string; text: string; z: number }>;
      deleteSticky(id: string): boolean;
      moveSticky(id: string, x: number, y: number): boolean;
      bringStickyToFront(id: string): boolean;
      setStickyColor(id: string, color: string): boolean;
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
  // Wait for the app (and its test-mode hooks) to be ready.
  await page.waitForFunction(() => typeof window.__vidi6 !== 'undefined');
  // Then wait for the initial camera to settle: the app recentres the origin
  // on the viewport centre once the viewport first has a size, and that
  // recentering discards any camera change made before it. Waiting for the
  // marker to land on the centre guarantees our setCamera runs afterwards.
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  await expect
    .poll(async () => {
      const c = await originMarkerCenter(page);
      return [c.x, c.y];
    })
    .toEqual([vp.width / 2, vp.height / 2]);
  await page.evaluate(
    ([cx, cy, cz]) => window.__vidi6?.setCamera(cx, cy, cz),
    [x, y, zoom],
  );
  // +0 normalizes -0 (which -0 * zoom would produce) so exact-origin
  // cameras compare equal to the measured position.
  await expect
    .poll(async () => {
      const c = await originMarkerCenter(page);
      return [c.x, c.y];
    })
    .toEqual([(-x * zoom) + 0, (-y * zoom) + 0]);
}

/** Computed dot-grid spacing in CSS pixels (expected: GRID_SPACING_WORLD * zoom). */
export async function gridSpacingPx(page: Page): Promise<string> {
  return page.getByTestId('board-viewport').evaluate((el) => getComputedStyle(el).backgroundSize);
}

export { GRID_SPACING_WORLD };
