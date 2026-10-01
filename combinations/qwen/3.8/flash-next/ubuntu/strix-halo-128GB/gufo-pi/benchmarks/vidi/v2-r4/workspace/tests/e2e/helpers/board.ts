import { expect, type Locator, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

/** The test-only camera API compiled into the `test` build. */
export interface TestCamera {
  x?: number;
  y?: number;
  zoom?: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function board(page: Page): Locator {
  return page.getByTestId('board-viewport');
}

export function worldLayer(page: Page): Locator {
  return page.getByTestId('world-layer');
}

/** The crosshair at world (0,0): a stable pixel target for every assertion. */
export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function navigationHint(page: Page): Locator {
  return page.getByTestId('navigation-hint');
}

export function zoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetViewButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reset view' });
}

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(board(page)).toBeVisible();
  await expect.poll(() => getCamera(page)).toMatchObject({ zoom: 1 });
}

/** Jump the camera directly (test build only) instead of dragging a million px. */
export async function setCamera(page: Page, camera: TestCamera): Promise<void> {
  await page.evaluate((value) => {
    const api = (window as unknown as { __vidi6?: { setCamera(c: TestCamera): void } }).__vidi6;
    if (!api) throw new Error('window.__vidi6 is not installed; run the test build');
    api.setCamera(value);
  }, camera);
  await page.waitForTimeout(50);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const api = (
      window as unknown as { __vidi6?: { getCamera(): Camera } }
    ).__vidi6;
    if (!api) throw new Error('window.__vidi6 is not installed; run the test build');
    return api.getCamera();
  });
}

/** Centre of the origin marker in viewport (CSS) pixels. */
export async function originMarkerCentre(page: Page): Promise<ScreenPoint> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The dot grid as the browser sees it: tile size and tile origin of the board's
 * background, which is where the painted dots live.
 */
export async function gridStyle(page: Page): Promise<{
  spacingX: number;
  spacingY: number;
  offsetX: number;
  offsetY: number;
}> {
  const value = await board(page).evaluate((el) => {
    const style = window.getComputedStyle(el);
    return [style.backgroundSize, style.backgroundPosition].join('|');
  });
  const [sizePart, positionPart] = value.split('|');
  const size = numbersOf(sizePart);
  const position = numbersOf(positionPart);
  return {
    spacingX: size[0],
    spacingY: size[1] ?? size[0],
    offsetX: position[0],
    offsetY: position[1] ?? position[0],
  };
}

function numbersOf(value: string): number[] {
  return (value.match(/-?[\d.]+/g) ?? []).map(Number);
}

/** Drag the board from one point to another, following the pointer. */
export async function dragBoard(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Zoom the board with a Ctrl/Cmd-scroll (or trackpad pinch) at a point. */
export async function ctrlWheel(page: Page, at: ScreenPoint, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await page.waitForTimeout(50);
}

/** Click a button until it refuses (is disabled). Stops at a zoom limit. */
export async function clickUntilDisabled(button: Locator): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const clicked = await button
      .click({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return;
  }
  throw new Error('button never became disabled');
}

export function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** Assert the dot grid is where the camera says it should be. */
export async function expectGridAttachedToCamera(page: Page, tolerance = 1): Promise<void> {
  const camera = await getCamera(page);
  const grid = await gridStyle(page);
  expectNear(grid.spacingX, GRID_SPACING_WORLD * camera.zoom, 0.02);
  expectNear(grid.spacingY, GRID_SPACING_WORLD * camera.zoom, 0.02);
  const expectedOffsetX = mod(-camera.x * camera.zoom, GRID_SPACING_WORLD * camera.zoom);
  const expectedOffsetY = mod(-camera.y * camera.zoom, GRID_SPACING_WORLD * camera.zoom);
  expectNear(grid.offsetX, expectedOffsetX, tolerance);
  expectNear(grid.offsetY, expectedOffsetY, tolerance);
}

function mod(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

/**
 * Assert the painted dot grid moved by exactly (`dx`, `dy`) screen pixels.
 *
 * The grid is a repeating background, so only its position modulo one tile is
 * observable; a movement is exact when the residual after removing (`dx`, `dy`)
 * is a whole number of tiles.
 */
export async function expectGridMovedBy(
  page: Page,
  before: { spacingX: number; spacingY: number; offsetX: number; offsetY: number },
  dx: number,
  dy: number,
  tolerance = 0.5,
): Promise<void> {
  const after = await gridStyle(page);
  expectNear(after.spacingX, before.spacingX, 0.02);
  expectNear(after.spacingY, before.spacingY, 0.02);
  expectClosestToWholeTiles(after.offsetX - before.offsetX - dx, after.spacingX, tolerance);
  expectClosestToWholeTiles(after.offsetY - before.offsetY - dy, after.spacingY, tolerance);
}

function expectClosestToWholeTiles(residual: number, tileSize: number, tolerance: number): void {
  const distance = Math.min(mod(residual, tileSize), mod(-residual, tileSize));
  expect(distance).toBeLessThanOrEqual(tolerance);
}
