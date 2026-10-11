import { expect, type Locator, type Page } from '@playwright/test';

import type { Camera } from '../../../src/client/canvas/camera';

const VIEWPORT_SIZE = { width: 1280, height: 800 };
/** Half the board area: where Reset view puts the board's starting point. */
export const CENTRE = { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 };

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const viewportLocator = (page: Page): Locator => page.locator('[data-testid="viewport"]');
export const originMarker = (page: Page): Locator => page.locator('[data-testid="origin-marker"]');
export const hintLocator = (page: Page): Locator => page.locator('[data-testid="navigation-hint"]');
export const zoomLabel = (page: Page): Locator => page.locator('[data-testid="zoom-label"]');
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom out' });
export const resetViewButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Reset view' });

// NOTE: code passed to page.evaluate/page.waitForFunction is serialised on its
// own, so it cannot close over module constants - the error text is inlined.
/** The camera the board is currently rendering. */
export function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing: run the tests against the test build');
    return api.getCamera();
  });
}

/** Move the camera with the test-only hook and wait for the board to show it. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing: run the tests against the test build');
    api.setCamera(next);
  }, camera);
  await page.waitForFunction(
    (expected) => {
      const api = window.__vidi6;
      if (!api) throw new Error('window.__vidi6 is missing: run the tests against the test build');
      const cam = api.getCamera();
      return cam.x === expected.x && cam.y === expected.y && cam.zoom === expected.zoom;
    },
    camera,
  );
  await waitForRender(page);
}

/** Wait until the rendered world layer carries the current camera. */
export async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * The screen position of the board's starting point (world 0,0), read from a
 * zero-size anchor element so it is exact even when it is off screen.
 */
export async function startingPoint(page: Page): Promise<ScreenPoint> {
  const point = await originMarker(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  return point;
}

/** Press and drag the board with the mouse, in a straight line. */
export async function dragBoard(page: Page, from: ScreenPoint, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await waitForRender(page);
}

/** Ctrl+wheel (the event a trackpad pinch sends) at a screen point. */
export async function ctrlWheel(page: Page, at: ScreenPoint, deltaY: number) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await waitForRender(page);
}

/** A plain scroll over the board. */
export async function scrollBoard(page: Page, at: ScreenPoint, deltaX: number, deltaY: number) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(deltaX, deltaY);
  await waitForRender(page);
}

/** The dot grid's CSS spacing in pixels for the current zoom. */
export async function gridSpacingPx(page: Page): Promise<number> {
  const size = await viewportLocator(page).evaluate((element) => {
    const match = /^([-\d.]+)px ([-\d.]+)px$/.exec(getComputedStyle(element).backgroundSize);
    if (!match) throw new Error(`unexpected background-size: ${getComputedStyle(element).backgroundSize}`);
    return Number.parseFloat(match[1]);
  });
  return size;
}

/** The dot grid's CSS offsets in pixels (x and y) - kept inside one cell. */
export async function gridOffsets(page: Page): Promise<number[]> {
  return viewportLocator(page).evaluate((element) =>
    getComputedStyle(element)
      .backgroundPosition.split(/[,\s]+/)
      .filter(Boolean)
      .map(Number.parseFloat),
  );
}

export async function expectClose(actual: number, expected: number, tolerance = 1): Promise<void> {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** Click Zoom in until it becomes disabled, or fail after `maxClicks`. */
export async function clickZoomInUntilDisabled(page: Page, maxClicks = 30): Promise<void> {
  for (let clicks = 0; clicks < maxClicks; clicks += 1) {
    const button = zoomInButton(page);
    if (await button.isDisabled()) return;
    await button.click({ timeout: 5_000 });
    // Let the board settle, so the disabled state cannot change mid-click.
    await waitForRender(page);
  }
  expect(await zoomInButton(page).isDisabled()).toBe(true);
}
