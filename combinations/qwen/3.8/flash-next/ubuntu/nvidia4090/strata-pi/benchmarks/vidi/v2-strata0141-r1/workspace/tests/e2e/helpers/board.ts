import type { Page } from '@playwright/test';
import { BOARD_PATH_PREFIX, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../../src/shared/config';

export { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT };

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 800;
export const VIEWPORT_CENTRE: ScreenPoint = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };

/** GRID_SPACING_WORLD and UNBOUNDED_PAN_TESTED_EXTENT are re-exported from src/shared/config. */

/** The board a page is on, read from its address. */
export function boardIdOfPage(page: Page): string {
  const url = new URL(page.url());
  if (!url.pathname.startsWith(BOARD_PATH_PREFIX)) {
    throw new Error(`page is not on a board: ${url.pathname}`);
  }
  return url.pathname.slice(BOARD_PATH_PREFIX.length);
}

/**
 * Open a board. With no `boardId` the page starts its own board (the app turns
 * `/` into `/b/<new address>`); with one it joins that board.
 * Returns the board address the page ended up on.
 *
 * `origin` sends the page to a server other than Playwright's `baseURL`, which
 * the restart tests need because each of them runs its own `wrangler dev`.
 */
export async function openBoard(
  page: Page,
  options: { boardId?: string; origin?: string } = {},
): Promise<string> {
  const origin = options.origin ?? '';
  await page.goto(
    options.boardId ? `${origin}${BOARD_PATH_PREFIX}${options.boardId}` : `${origin}/`,
  );
  await page.waitForSelector('[data-testid="board"]');
  await page.waitForSelector('[data-testid="world-layer"]');
  // Wait for the first camera render so measurements are stable.
  await markerPoint(page);
  return boardIdOfPage(page);
}

/** Centre of a marker's crosshair bar = the exact screen position of its world point. */
export async function markerPoint(page: Page, testId = 'origin-marker'): Promise<ScreenPoint> {
  const bar = page.locator(`[data-testid="${testId}"] span`).first();
  const box = await bar.boundingBox();
  if (!box) {
    throw new Error(`marker ${testId} has no bounding box`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-percent').textContent()) ?? '';
}

/** The zoom as a number, e.g. "125%" -> 125. */
export async function zoomPercent(page: Page): Promise<number> {
  return Number((await zoomLabel(page)).replace('%', ''));
}

export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((value) => {
    const hooks = (window as unknown as { __vidi6?: { setCamera(c: Camera): void } }).__vidi6;
    if (!hooks) {
      throw new Error('test hooks are not installed');
    }
    hooks.setCamera(value);
  }, camera);
  await page.waitForTimeout(50);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __vidi6?: { getCamera(): Camera | null } }).__vidi6;
    const camera = hooks?.getCamera();
    if (!camera) {
      throw new Error('test hooks are not installed');
    }
    return camera;
  });
}

export interface GridStyle {
  spacingPx: number;
  offsetX: number;
  offsetY: number;
}

export async function gridStyle(page: Page): Promise<GridStyle> {
  const raw = await page
    .locator('[data-testid="board"]')
    .evaluate((el) => {
      const style = getComputedStyle(el as HTMLElement);
      return { size: style.backgroundSize, position: style.backgroundPosition };
    });
  const [sizeX] = raw.size.split(' ').map(parseFloat);
  const [posX, posY] = raw.position.split(' ').map(parseFloat);
  return { spacingPx: sizeX ?? 0, offsetX: posX ?? 0, offsetY: posY ?? 0 };
}

/** Drag the board from (fromX, fromY) by (dx, dy). */
export async function dragBoard(
  page: Page,
  from: ScreenPoint,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Wheel with Ctrl held (trackpad pinch in Chrome/Firefox is delivered this way). */
export async function ctrlWheel(page: Page, at: ScreenPoint, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(80);
  await page.keyboard.up('Control');
}

export function near(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
