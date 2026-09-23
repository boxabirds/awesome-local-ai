/**
 * Story 1 · task 7 — e2e helpers.
 *
 * These deliberately do NOT reimplement the camera maths: the maths is pinned
 * to the last bit in `tests/unit/camera.test.ts`. Here we assert on facts the
 * page *shows* — the stamped camera, measured bounding boxes and sampled
 * pixels — so the rendering layer is genuinely checked, not echoed.
 */
import { expect, type Page } from '@playwright/test';

export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export type Raster = { width: number; height: number; data: number[] };

/** Wait for the page to paint (camera commits are rAF-batched). */
export async function settle(page: Page, frames = 3): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(
      () =>
        new Promise<null>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
        }),
    );
  }
}

/** The board area the page is drawing into (the app measures this itself). */
export async function viewportSize(page: Page): Promise<Size> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** The camera the page is currently rendering (test-only hook). */
export async function getCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => {
    const hook = (window as unknown as { __vidi6?: { getCamera: () => Camera } }).__vidi6;
    return hook ? hook.getCamera() : null;
  });
  if (!camera) throw new Error('the test-only camera hook is not available');
  return camera;
}

/** Jump the camera directly, then let the page paint. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    const hook = (
      window as unknown as { __vidi6?: { setCamera: (camera: Camera) => void } }
    ).__vidi6;
    if (!hook) throw new Error('the test-only camera hook is not available');
    hook.setCamera(next);
  }, camera);
  await settle(page);
}

/** Screen position of the world-origin marker, measured from the DOM. */
export async function markerPosition(page: Page): Promise<Point> {
  const position = await page.evaluate(() => {
    const marker = document.querySelector('[data-testid="origin-marker"]');
    if (!marker) return null;
    const rect = marker.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  if (!position) throw new Error('the origin marker is missing');
  return position;
}

/** The dot-grid geometry the surface is painting right now. */
export async function gridGeometry(page: Page): Promise<{ spacing: number; position: Point }> {
  return page.evaluate(() => {
    const surface = document.querySelector('[data-testid="board-viewport"]');
    if (!surface) throw new Error('the board surface is missing');
    const style = getComputedStyle(surface);
    const [sizePart] = style.backgroundSize.split(',');
    const [positionPart] = style.backgroundPosition.split(',');
    const [width] = sizePart.trim().split(' ');
    const [x, y] = positionPart.trim().split(' ').map((value) => Number.parseFloat(value));
    return { spacing: Number.parseFloat(width), position: { x, y } };
  });
}

/**
 * Screen position of the grid dot nearest to `point`, derived from the camera
 * the page reports. Dots are painted at multiples of the world grid spacing,
 * so this is where a dot must be visible if the renderer is correct.
 */
export function nearestDot(camera: Camera, spacing: number, point: Point): Point {
  const toScreen = (world: number, offset: number) => (world - offset) * camera.zoom;
  const worldX = Math.round((point.x / camera.zoom + camera.x) / spacing) * spacing;
  const worldY = Math.round((point.y / camera.zoom + camera.y) / spacing) * spacing;
  return { x: toScreen(worldX, camera.x), y: toScreen(worldY, camera.y) };
}

/** Decode a screenshot region into luminance values (0-255), one per pixel. */
export async function sampleRegion(
  page: Page,
  x: number,
  y: number,
  size: number,
): Promise<Raster> {
  const png = await page.screenshot({
    type: 'png',
    clip: { x: Math.round(x), y: Math.round(y), width: size, height: size },
  });
  return page.evaluate(
    async ({ data }) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(data), (character) => character.charCodeAt(0))], {
          type: 'image/png',
        }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const luminance: number[] = [];
      for (let index = 0; index < pixels.data.length; index += 4) {
        luminance.push(
          (pixels.data[index] + pixels.data[index + 1] + pixels.data[index + 2]) / 3,
        );
      }
      return { width: bitmap.width, height: bitmap.height, data: luminance };
    },
    { data: png.toString('base64') },
  );
}

/**
 * True when a grid dot is painted at `point`. Dots are #b7bfcc over a
 * #f7f8fa background, so a painted dot is measurably darker than its
 * surroundings; the board background itself never falls below the threshold.
 */
export async function hasDotAt(page: Page, point: Point, radius = 2): Promise<boolean> {
  const size = radius * 2 + 1;
  // The screenshot clip must start inside the viewport.
  const raster = await sampleRegion(page, point.x - radius, point.y - radius, size);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const value = raster.data[y * raster.width + x];
      if (value !== undefined && value < 235) return true;
    }
  }
  return false;
}

/** Assert a dot is painted at the given screen point (within ~1 CSS pixel). */
export async function expectDotAt(page: Page, point: Point): Promise<void> {
  expect(
    await hasDotAt(page, point),
    `expected a grid dot painted at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`,
  ).toBe(true);
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label')).innerText();
}
