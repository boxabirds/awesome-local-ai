// Shared Playwright helpers for board navigation e2e tests.

import { expect, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';

/**
 * Creates a board via the TEST_HOOKS initialize endpoint (bypassing the
 * rate-limited creation API) and opens it at /b/<id>. Resolves once the
 * board viewport is rendered. Returns the board id.
 */
export async function openBoard(page: Page, boardId?: string): Promise<string> {
  const id = boardId ?? newBoardId();
  const res = await page.request.post(`/_test/${id}/initialize`);
  if (res.status() !== 200) {
    throw new Error(`board initialize failed: ${res.status()} ${await res.text()}`);
  }
  await page.goto(`/b/${id}`);
  await page.getByTestId('board-viewport').waitFor();
  return id;
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
export { newBoardId };
