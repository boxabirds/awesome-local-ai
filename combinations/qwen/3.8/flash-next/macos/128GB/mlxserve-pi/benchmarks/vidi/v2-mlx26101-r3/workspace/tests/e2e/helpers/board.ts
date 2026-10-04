/// <reference path="../../../src/client/testHooks.ts" />
// The one declaration of `window.__vidi6` lives in src/client/testHooks.ts - the file that
// puts the hooks there - and this reaches for it by path rather than by import, so that a test
// helper does not pull a client module into the test run.
import { expect, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const VIEWPORT = { width: 1280, height: 800 };

export interface ScreenPoint {
  x: number;
  y: number;
}

export const board = (page: Page): Locator => page.getByTestId('board-viewport');
export const worldLayer = (page: Page): Locator => page.getByTestId('world-layer');
export const gridLayer = (page: Page): Locator => page.getByTestId('grid-layer');
export const marker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-percent');
export const hint = (page: Page): Locator => page.getByTestId('navigation-hint');
export const zoomInButton = (page: Page): Locator =>
  page.getByTestId('zoom-controls').getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator =>
  page.getByTestId('zoom-controls').getByRole('button', { name: 'Zoom out' });
export const resetButton = (page: Page): Locator =>
  page.getByTestId('zoom-controls').getByRole('button', { name: 'Reset view' });

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(marker(page)).toBeVisible();
}

/** Centre of the origin marker (the crosshair at world 0,0) in viewport pixels. */
export async function markerCentre(page: Page): Promise<ScreenPoint> {
  const box = await marker(page).boundingBox();
  if (box === null) {
    throw new Error('origin marker has no bounding box');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom level shown in the control, e.g. "125%". */
export async function zoomText(page: Page): Promise<string> {
  return (await zoomLabel(page).innerText()).trim();
}

export async function zoomNumber(page: Page): Promise<number> {
  return Number((await zoomText(page)).replace('%', ''));
}

/** The camera the DOM is currently rendering, read off the world layer. */
export async function readCamera(page: Page): Promise<Camera> {
  const raw = await worldLayer(page).getAttribute('data-camera');
  if (raw === null) {
    throw new Error('world layer has no camera readout');
  }
  const [x, y, zoom] = raw.split(',').map(Number) as [number, number, number];
  return { x, y, zoom };
}

export interface GridStyle {
  /** On-screen distance between two grid lines in pixels. */
  spacing: number;
  x: number;
  y: number;
}

/** The rendered dot-grid geometry. */
export async function readGrid(page: Page): Promise<GridStyle> {
  const style = await gridLayer(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { size: computed.backgroundSize, position: computed.backgroundPosition };
  });
  const [width] = style.size.split(' ').map((part) => Number.parseFloat(part));
  const [x, y] = style.position.split(' ').map((part) => Number.parseFloat(part));
  if (width === undefined || x === undefined || y === undefined) {
    throw new Error(`unexpected grid style: ${JSON.stringify(style)}`);
  }
  return { spacing: width, x, y };
}

/** Jump the camera with the test hook (only compiled into the test build). */
export async function setCamera(page: Page, camera: Partial<Camera>): Promise<void> {
  const applied = await page.evaluate((partial) => {
    if (typeof window.__vidi6?.setCamera !== 'function') {
      return false;
    }
    window.__vidi6.setCamera(partial);
    return true;
  }, camera);
  expect(applied, 'window.__vidi6.setCamera should exist in the test build').toBe(true);
  await settle(page);
}

/** Drag the board with the mouse from one screen point to another. */
export async function dragBoard(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

/** Scroll with the wheel; Ctrl or Cmd can be held for a zoom gesture. */
export async function scrollBoard(
  page: Page,
  at: ScreenPoint,
  delta: { x?: number; y?: number },
  modifier?: 'Control' | 'Meta',
): Promise<void> {
  await page.mouse.move(at.x, at.y);
  if (modifier !== undefined) {
    await page.keyboard.down(modifier);
  }
  await page.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
  if (modifier !== undefined) {
    await page.keyboard.up(modifier);
  }
  await settle(page);
}

/** Wait until the rendered DOM has caught up with the camera state (two frames). */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * True when `value` is a whole multiple of `spacing` within `tolerance`. Used to check
 * that a dot-grid offset moved by exactly the pointer delta: dots repeat every spacing,
 * so a movement that is congruent to the delta modulo the spacing moved every dot.
 */
export function isMultipleOf(value: number, spacing: number, tolerance: number): boolean {
  const remainder = ((value % spacing) + spacing) % spacing;
  return Math.min(remainder, spacing - remainder) <= tolerance;
}

/** Assert-free pixel distance helper. */
export function distance(a: ScreenPoint, b: ScreenPoint): { dx: number; dy: number } {
  return { dx: a.x - b.x, dy: a.y - b.y };
}
