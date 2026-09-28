import { expect, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
// Registers the `window.__vidi6` type declaration.
import '../../../src/client/canvas/testHooks';

export const boardLocator = (page: Page): Locator => page.getByTestId('board');
export const worldLocator = (page: Page): Locator => page.getByTestId('board-world');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-percent');
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom out' });
export const resetButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset view' });
export const navigationHint = (page: Page): Locator => page.getByTestId('navigation-hint');
export const zoomControls = (page: Page): Locator => page.getByTestId('zoom-controls');

/** The crosshair's horizontal bar — a visible box whose centre is exactly world (0,0). */
const originBar = (page: Page): Locator => page.getByTestId('origin-marker').locator('.origin-marker-h');

export interface Dot {
  x: number;
  y: number;
}

/** Screen position of the board's starting point, measured from the rendered DOM. */
export async function originPoint(page: Page): Promise<Dot> {
  const box = await originBar(page).boundingBox();
  if (!box) throw new Error('origin marker is not visible (is it off-screen?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The camera as reported by the board's data attributes. */
export async function readCamera(page: Page): Promise<Camera> {
  return boardLocator(page).evaluate((el) => ({
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.cameraZoom),
  }));
}

/** Rendered dot-grid geometry from computed CSS. */
export interface GridStyle {
  sizeX: number;
  sizeY: number;
  posX: number;
  posY: number;
  repeat: string;
}

export async function readGridStyle(page: Page): Promise<GridStyle> {
  return boardLocator(page).evaluate((el) => {
    const style = getComputedStyle(el);
    const [sizeX = 0, sizeY = 0] = style.backgroundSize.split(' ').map(parseFloat);
    const [posX = 0, posY = 0] = style.backgroundPosition.split(' ').map(parseFloat);
    return { sizeX, sizeY, posX, posY, repeat: style.backgroundRepeat };
  });
}

/** Jump the camera with the test hook (only present in `vite build --mode test`). */
export async function setCamera(page: Page, camera: Partial<Camera>): Promise<void> {
  const available = await page.evaluate(() => typeof window.__vidi6?.setCamera === 'function');
  if (!available) {
    throw new Error(
      'window.__vidi6.setCamera is missing: e2e must run against a test-mode build (npm run build:test)',
    );
  }
  await page.evaluate((value) => window.__vidi6?.setCamera?.(value), camera);
  await page.waitForTimeout(50);
}

/** Ctrl/Cmd + wheel over a point of the board. */
export async function ctrlWheel(page: Page, point: Dot, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await page.waitForTimeout(50);
}

/** Drag the board surface by (dx, dy) screen pixels from an empty spot. */
export async function dragBoard(page: Page, from: Dot, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

/** Browser page-zoom indicators, which board gestures must never change. */
export async function pageZoomState(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}

export const modulo = (value: number, period: number): number =>
  period <= 0 ? 0 : ((value % period) + period) % period;

/** Assert two screen points are within `tolerance` pixels of each other. */
export function expectClosePoints(actual: Dot, expected: Dot, tolerance = 1): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

/** Assert the rendered label matches the camera to the nearest whole percent. */
export async function expectLabelMatchesCamera(page: Page): Promise<void> {
  const camera = await readCamera(page);
  const label = (await zoomLabel(page).textContent()) ?? '';
  expect(label).toBe(`${Math.round(camera.zoom * 100)}%`);
}

/**
 * Click a zoom button and wait for the board to render the new zoom. The board
 * paints camera changes on the next animation frame, so reading the DOM right
 * after a click can otherwise see the previous frame.
 */
export async function clickZoomButtonAndWait(page: Page, button: Locator): Promise<string> {
  const before = (await zoomLabel(page).textContent()) ?? '';
  await button.click();
  await expect
    .poll(() => zoomLabel(page).textContent(), { timeout: 3000 })
    .not.toBe(before);
  return (await zoomLabel(page).textContent()) ?? '';
}

/** Click a zoom button until it disables itself, recording each label seen. */
export async function clickUntilDisabled(
  page: Page,
  button: Locator,
  seen: string[] = [],
): Promise<string[]> {
  for (let i = 0; i < 30; i += 1) {
    if (!(await button.isEnabled())) break;
    seen.push(await clickZoomButtonAndWait(page, button));
  }
  return seen;
}
