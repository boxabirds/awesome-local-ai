import { expect, type Locator, type Page } from '@playwright/test';
import type { Camera, Point } from '../../../src/client/canvas/camera';
import { createBoardId } from './server';

export function viewport(page: Page): Locator {
  return page.getByTestId('board-viewport');
}

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function zoomLabel(page: Page): Locator {
  return page.getByRole('status', { name: 'Zoom level' });
}

/** Opens a new board (created through the API, story 5). */
export async function openBoard(page: Page): Promise<void> {
  await page.goto(`/b/${await createBoardId()}`);
  await expect(viewport(page)).toBeVisible();
  await page.waitForFunction(() => window.__vidi6 !== undefined);
}

export async function originCentre(page: Page): Promise<Point> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Jump the camera via the test-only hook, then wait for the frame to render it. */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
  await expect(viewport(page)).toHaveAttribute('data-camera-zoom', String(cam.zoom));
  await expect(viewport(page)).toHaveAttribute('data-camera-x', String(cam.x));
}

export interface GridMetrics {
  size: number;
  offsetX: number;
  offsetY: number;
}

/** Reads the rendered dot grid (background tile size and position) from computed style. */
export async function gridMetrics(page: Page): Promise<GridMetrics> {
  return viewport(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    const [size] = cs.backgroundSize.split(' ').map(parseFloat);
    const [offsetX, offsetY] = cs.backgroundPosition.split(' ').map(parseFloat);
    return { size, offsetX, offsetY };
  });
}

/** Screen position of the grid dot nearest to `p` (dots sit at tile centres). */
export function nearestDot(grid: GridMetrics, p: Point): Point {
  const snap = (v: number, offset: number) =>
    offset + grid.size / 2 + Math.round((v - offset - grid.size / 2) / grid.size) * grid.size;
  return { x: snap(p.x, grid.offsetX), y: snap(p.y, grid.offsetY) };
}

/** True when a grid dot is rendered at screen point `p` (±tol px). */
export function isDotAt(grid: GridMetrics, p: Point, tol = 1): boolean {
  const d = nearestDot(grid, p);
  return Math.abs(d.x - p.x) <= tol && Math.abs(d.y - p.y) <= tol;
}

export async function drag(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, dpr: window.devicePixelRatio }));
}

/** Clicks `button` until it becomes disabled, waiting for the zoom label to update after each click. */
export async function clickUntilDisabled(page: Page, button: Locator, maxClicks: number): Promise<string[]> {
  const labels: string[] = [];
  for (let i = 0; i < maxClicks; i++) {
    if (await button.isDisabled()) break;
    const before = await zoomLabel(page).textContent();
    await button.click();
    await expect(zoomLabel(page)).not.toHaveText(before ?? '');
    labels.push((await zoomLabel(page).textContent()) ?? '');
  }
  return labels;
}
