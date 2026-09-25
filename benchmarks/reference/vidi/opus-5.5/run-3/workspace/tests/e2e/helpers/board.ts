import { expect, type Page } from '@playwright/test';
import type { Camera, Point } from '../../../src/client/canvas/camera';

export async function openBoard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await page.waitForFunction(() => window.__vidi6 !== undefined);
}

/** Centre of the origin crosshair (world 0,0) in page pixels. */
export async function originMarker(page: Page): Promise<Point> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page) {
  return page.locator('output[aria-live="polite"]');
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Waits for the next two animation frames so batched camera updates have rendered. */
export async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export interface GridGeometry {
  spacing: number;
  offsetX: number;
  offsetY: number;
}

/** Reads the dot grid from the viewport's computed background. Dots sit at offset + spacing/2 + k*spacing. */
export async function grid(page: Page): Promise<GridGeometry> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = getComputedStyle(el);
    const [sx] = s.backgroundSize.split(' ').map(parseFloat);
    const [ox, oy] = s.backgroundPosition.split(' ').map(parseFloat);
    return { spacing: sx, offsetX: ox, offsetY: oy };
  });
}

/** Distance (px) from `p` to the nearest grid dot on each axis. */
export function distanceToDot(g: GridGeometry, p: Point): Point {
  const d = (v: number, o: number) => {
    const r = (((v - o - g.spacing / 2) % g.spacing) + g.spacing) % g.spacing;
    return Math.min(r, g.spacing - r);
  };
  return { x: d(p.x, g.offsetX), y: d(p.y, g.offsetY) };
}

/** Screen position of the grid dot nearest to `p`. */
export function nearestDot(g: GridGeometry, p: Point): Point {
  const n = (v: number, o: number) => Math.round((v - o - g.spacing / 2) / g.spacing) * g.spacing + o + g.spacing / 2;
  return { x: n(p.x, g.offsetX), y: n(p.y, g.offsetY) };
}

export async function drag(page: Page, from: Point, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

export async function pageZoom(page: Page) {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
  }));
}
