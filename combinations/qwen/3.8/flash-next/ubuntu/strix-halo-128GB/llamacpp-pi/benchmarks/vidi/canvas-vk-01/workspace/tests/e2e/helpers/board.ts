import { expect, type Locator, type Page } from '@playwright/test';

/** Exact copy of the first-use hint (PRD nav.hint). */
export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** Acceptable visual difference for "1px" style assertions. */
export const PIXEL_TOLERANCE = 1;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface GridStyle {
  /** background-size, e.g. "24px 24px". */
  size: string;
  /** background-position, e.g. "8px 4px". */
  position: string;
  tile: number;
  offsetX: number;
  offsetY: number;
}

export interface ViewportMetrics {
  devicePixelRatio: number;
  visualViewportScale: number;
  innerWidth: number;
  innerHeight: number;
}

export const viewport = (page: Page): Locator => page.getByTestId('board-viewport');
export const worldLayer = (page: Page): Locator => page.getByTestId('world-layer');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const hint = (page: Page): Locator => page.getByTestId('navigation-hint');
export const zoomPercentLabel = (page: Page): Locator => page.getByTestId('zoom-percent');
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom out' });
export const resetViewButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Reset view' });

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(viewport(page)).toBeVisible();
  // The app must be mounted and interactive before gestures are sent.
  await expect(zoomPercentLabel(page)).toHaveText(/\d+%/);
}

/** Centre of the origin marker: the marker is centred on world (0, 0). */
export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('the origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Jump the camera with the test-mode hook (see src/client/canvas/testHooks.ts). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((value) => {
    const hooks = (
      window as unknown as {
        __vidi6?: { setCamera(camera: { x: number; y: number; zoom: number }): void };
      }
    ).__vidi6;
    if (!hooks) {
      throw new Error('window.__vidi6 is missing; build the client with `--mode test`');
    }
    hooks.setCamera(value);
  }, camera);
}

export async function readGrid(page: Page): Promise<GridStyle> {
  const style = await viewport(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { size: computed.backgroundSize, position: computed.backgroundPosition };
  });
  const [sizeX = '0px'] = style.size.split(' ');
  const [positionX = '0px', positionY = '0px'] = style.position.split(' ');
  return {
    size: style.size,
    position: style.position,
    tile: Number.parseFloat(sizeX),
    offsetX: Number.parseFloat(positionX),
    offsetY: Number.parseFloat(positionY),
  };
}

/** Same maths the board uses: the grid offset is the camera offset modulo the tile. */
export function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export async function dragBoard(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  await page.mouse.move(midX, midY, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Ctrl + wheel over the board (Chromium reports the modifier to the page). */
export async function ctrlWheel(page: Page, at: { x: number; y: number }, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

export async function metrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport ? window.visualViewport.scale : 1,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

export async function clickResetView(page: Page): Promise<void> {
  await resetViewButton(page).click();
  await expect(zoomPercentLabel(page)).toHaveText('100%');
}

/**
 * Click a zoom button until it disables itself. `force` avoids an actionability
 * race: a click that lands after the button became disabled is a no-op in the DOM.
 */
export async function clickZoomUntilDisabled(button: Locator): Promise<number> {
  let clicks = 0;
  for (let i = 0; i < 40; i += 1) {
    if (await button.isDisabled()) break;
    await button.click({ force: true });
    clicks += 1;
  }
  return clicks;
}

/** Wait for the origin marker to settle at `point` (camera updates are rAF-batched). */
export async function expectMarkerAt(
  page: Page,
  point: { x: number; y: number },
  tolerance = PIXEL_TOLERANCE,
): Promise<void> {
  await expect
    .poll(async () => {
      const centre = await markerCentre(page);
      return Math.max(Math.abs(centre.x - point.x), Math.abs(centre.y - point.y));
    })
    .toBeLessThanOrEqual(tolerance);
}

/** Wait for the grid tile size and offset to settle. */
export async function expectGrid(
  page: Page,
  expected: { tile?: number; offsetX?: number; offsetY?: number },
  tolerance = 0.5,
): Promise<void> {
  await expect
    .poll(async () => {
      const grid = await readGrid(page);
      return Math.max(
        expected.tile === undefined ? 0 : Math.abs(grid.tile - expected.tile),
        expected.offsetX === undefined ? 0 : Math.abs(grid.offsetX - expected.offsetX),
        expected.offsetY === undefined ? 0 : Math.abs(grid.offsetY - expected.offsetY),
      );
    })
    .toBeLessThanOrEqual(tolerance);
}

export function centreOf(page: Page): { x: number; y: number } {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: size.width / 2, y: size.height / 2 };
}
