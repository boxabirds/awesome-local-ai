import { expect, type Page } from '@playwright/test';
import type { Camera, Point } from '../../../src/client/canvas/camera';

export const PIXEL_TOLERANCE = 1;

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await page.waitForFunction(() => window.__vidi6 !== undefined);
}

export async function originMarkerCentre(page: Page): Promise<Point> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (box === null) throw new Error('origin marker not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-percent');
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hooks = window.__vidi6;
    if (hooks === undefined) throw new Error('test hook missing');
    return hooks.getCamera();
  });
}

/** Jumps the camera via the test-only hook and waits for it to render. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), camera);
  // The world layer's computed matrix is (zoom, 0, 0, zoom, -x*zoom, -y*zoom) once rendered.
  await expect
    .poll(() =>
      page.getByTestId('world-layer').evaluate((el, c) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return (
          Math.abs(m.a - c.zoom) < 1e-9 &&
          Math.abs(m.e + c.x * c.zoom) <= 1 &&
          Math.abs(m.f + c.y * c.zoom) <= 1
        );
      }, camera),
    )
    .toBe(true);
}

export interface Grid {
  spacing: number;
  /** Screen position (viewport-relative) of one dot; others are at multiples of spacing. */
  anchor: Point;
}

/** Reads the rendered dot grid from the viewport's computed background. */
export async function readGrid(page: Page): Promise<Grid> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const style = getComputedStyle(el);
    const spacing = parseFloat(style.backgroundSize);
    const [px, py] = style.backgroundPosition.split(' ').map((v) => parseFloat(v));
    // Each dot is drawn in the centre of its background tile.
    return { spacing, anchor: { x: (px ?? 0) + spacing / 2, y: (py ?? 0) + spacing / 2 } };
  });
}

/** Distance from `p` to the nearest grid dot along each axis. */
export function distanceToNearestDot(grid: Grid, p: Point): Point {
  const along = (v: number, a: number) => {
    const r = (((v - a) % grid.spacing) + grid.spacing) % grid.spacing;
    return Math.min(r, grid.spacing - r);
  };
  return { x: along(p.x, grid.anchor.x), y: along(p.y, grid.anchor.y) };
}

/** A dot close to `near`. */
export function dotNear(grid: Grid, near: Point): Point {
  const snap = (v: number, a: number) => a + Math.round((v - a) / grid.spacing) * grid.spacing;
  return { x: snap(near.x, grid.anchor.x), y: snap(near.y, grid.anchor.y) };
}

export async function drag(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  const STEPS = 10;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: STEPS });
  await page.mouse.up();
}

export function expectNear(actual: Point, expected: Point, tolerance = PIXEL_TOLERANCE): void {
  expect(Math.abs(actual.x - expected.x), `x: ${actual.x} vs ${expected.x}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y), `y: ${actual.y} vs ${expected.y}`).toBeLessThanOrEqual(tolerance);
}
