import { expect, type Locator, type Page } from '@playwright/test';

import type { Camera } from '../../../src/client/canvas/camera';

/** Board element and control selectors (data-testids rendered in all builds). */
export const boardElement = (page: Page): Locator => page.getByTestId('board');
export const worldLayer = (page: Page): Locator => page.getByTestId('board-world');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-label');
export const navigationHint = (page: Page): Locator => page.getByTestId('navigation-hint');
export const zoomOutButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom out' });
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const resetViewButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset view' });

interface WindowWithTestHook {
  __vidi6: {
    setCamera(partial: Partial<Camera>): void;
    getCamera(): Camera;
  };
}

/** The camera the page has rendered (test build only). */
export function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => (window as unknown as WindowWithTestHook).__vidi6.getCamera());
}

/**
 * Jump the camera instead of dragging a million pixels. The hook only exists in
 * the test build, which is what `npm run test:e2e` serves.
 */
export async function setCamera(page: Page, partial: Partial<Camera>): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as WindowWithTestHook).__vidi6.setCamera(value);
  }, partial);
  await waitForRender(page);
}

/** Let the camera hook's coalesced animation frame run and settle. */
export async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Centre of the origin marker as rendered on screen. */
export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (box === null) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomPercentLabel(page: Page): Promise<string> {
  return (await zoomLabel(page).textContent()) ?? '';
}

/** Drag the board from one point to another. */
export async function dragBoard(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await waitForRender(page);
}

/** Ctrl/Cmd + wheel over the board (trackpad pinch equivalent). */
export async function zoomWheel(page: Page, at: { x: number; y: number }, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await waitForRender(page);
}

export function expectWithin(actual: number, expected: number, tolerance: number, what: string): void {
  expect(
    Math.abs(actual - expected),
    `${what}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Click a control until it disables. Camera updates render on an animation
 * frame, so the rendered state is re-read only after a frame has run.
 */
export async function clickUntilDisabled(page: Page, button: Locator, maxClicks = 40): Promise<void> {
  for (let step = 0; step < maxClicks; step += 1) {
    await waitForRender(page);
    if (await button.isDisabled()) return;
    await button.click();
  }
  throw new Error('control never became disabled');
}

/** Waits for the hint to appear, so pixel assertions start from a settled page. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(boardElement(page)).toBeVisible();
  await waitForRender(page);
}
