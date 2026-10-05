import { expect, type Locator, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../../src/shared/config';

export type Camera = { x: number; y: number; zoom: number };

/** Viewport size configured in playwright.config.ts. */
export const VIEWPORT = { width: 1280, height: 800 };
/** Pixel tolerance used by the PRD's "within 1 pixel" requirements. */
export const PIXEL_TOLERANCE = 1;
/** World-unit tolerance for far-away precision. */
export const WORLD_TOLERANCE = 1e-6;
export const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
export const STEP = ZOOM_STEP_FACTOR;
export const MIN_ZOOM = ZOOM_MIN;
export const MAX_ZOOM = ZOOM_MAX;
export const GRID = GRID_SPACING_WORLD;
export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export const board = (page: Page): Locator => page.getByTestId('board-viewport');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-label');
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom out' });
export const resetButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset view' });
export const hint = (page: Page): Locator => page.getByTestId('navigation-hint');

/** Loads the board and waits for the starting point to be centred. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(zoomLabel(page)).toHaveText('100%');
  await expectCamera(page, {
    x: -VIEWPORT.width / 2,
    y: -VIEWPORT.height / 2,
    zoom: 1,
  });
}

/** The camera as rendered in the DOM. */
export function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    return {
      x: Number(el.dataset['cameraX']),
      y: Number(el.dataset['cameraY']),
      zoom: Number(el.dataset['cameraZoom']),
    };
  });
}

/** Waits for the camera rendered in the DOM to reach the expected values. */
export async function expectCamera(page: Page, expected: Partial<Camera>): Promise<void> {
  const match: Record<string, unknown> = {};
  if (expected.x !== undefined) match['x'] = expect.closeTo(expected.x, 5);
  if (expected.y !== undefined) match['y'] = expect.closeTo(expected.y, 5);
  if (expected.zoom !== undefined) match['zoom'] = expect.closeTo(expected.zoom, 5);
  await expect
    .poll(() => readCamera(page), { message: `waiting for camera ${JSON.stringify(expected)}` })
    .toMatchObject(match);
}

/** Centre of the crosshair that marks the board's starting point (world 0,0). */
export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Grid cell size in screen pixels, from the board's computed background. */
export function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const [width] = getComputedStyle(el).backgroundSize.split(' ');
    return Number.parseFloat(width ?? 'NaN');
  });
}

/** Grid background offset in screen pixels. */
export function gridOffsetPx(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const [x, y] = getComputedStyle(el).backgroundPosition.split(' ');
    return { x: Number.parseFloat(x ?? 'NaN'), y: Number.parseFloat(y ?? 'NaN') };
  });
}

/** Camera delta the board applied for a drag of (dx, dy) screen pixels. */
export async function dragAndSettle(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<Camera> {
  const before = await readCamera(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => readCamera(page), { message: 'waiting for the drag to pan the board' })
    .toMatchObject({
      x: expect.closeTo(before.x - dx / before.zoom, 5),
      y: expect.closeTo(before.y - dy / before.zoom, 5),
      zoom: expect.closeTo(before.zoom, 5),
    });
  return readCamera(page);
}

/** Scrolls (or pinches with Ctrl/Cmd held) over a screen point. */
export async function wheelAt(
  page: Page,
  point: { x: number; y: number },
  deltaY: number,
  options: { ctrlKey?: boolean; deltaX?: number } = {},
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  if (options.ctrlKey) await page.keyboard.down('Control');
  await page.mouse.wheel(options.deltaX ?? 0, deltaY);
  if (options.ctrlKey) await page.keyboard.up('Control');
}

/** Jumps the camera somewhere else with the test-only window hook. */
export async function setCamera(page: Page, patch: Partial<Camera>): Promise<void> {
  const available = await page.evaluate(() => typeof window.__vidi6?.setCamera === 'function');
  if (!available) throw new Error('window.__vidi6 test hook is missing from this build');
  await page.evaluate((value) => window.__vidi6?.setCamera(value), patch);
}

/** Clicks a zoom button until it is disabled, collecting the labels seen. */
export async function zoomToLimit(page: Page, dir: 'in' | 'out'): Promise<string[]> {
  const button = dir === 'in' ? zoomInButton(page) : zoomOutButton(page);
  const labels: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    if (!(await button.isEnabled())) break;
    const previous = await zoomLabel(page).textContent();
    await button.click();
    await expect
      .poll(async () => zoomLabel(page).textContent(), { message: 'waiting for the label' })
      .not.toBe(previous);
    labels.push((await zoomLabel(page).textContent()) ?? '');
  }
  return labels;
}

/** The board's page-zoom signals: they must never change. */
export function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}

/** Grid offset the board should show for a camera position. */
export const gridOffsetFor = (value: number, spacing: number): number =>
  Number((((value % spacing) + spacing) % spacing).toFixed(6));
