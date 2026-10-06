import { expect, type Locator, type Page } from '@playwright/test';

import type { Camera, Point } from '../../../src/client/canvas/camera.js';
import { decodePng, meanDifference, meanLightness, type Image } from './png.js';
import { createBoardPath } from './boards.js';

/** The board area the tests run in (matches playwright.config.ts). */
export const VIEWPORT = { width: 1280, height: 800 };
/** Centre of the board area: the origin sits here at the standard view. */
export const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** The PRD's verification drag: 200 px right and 100 px down. */
export const DRAG: Point = { x: 200, y: 100 };
/** Where a drag starts, away from the controls and the hint. */
export const DRAG_FROM: Point = { x: 400, y: 300 };

export const boardArea = (page: Page): Locator => page.getByTestId('board-viewport');
export const worldLayer = (page: Page): Locator => page.getByTestId('world-layer');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-label');
export const navigationHint = (page: Page): Locator => page.getByTestId('navigation-hint');
export const zoomInButton = (page: Page): Locator => page.getByLabel('Zoom in');
export const zoomOutButton = (page: Page): Locator => page.getByLabel('Zoom out');
export const resetViewButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset view' });

/**
 * Open a board and wait until the standard view is drawn.
 *
 * The board is created first, by the route the home page's button uses. It used to be
 * enough to drive to `/` and be shown a board; since story 5 the home page makes boards and
 * a board page is an address that a server has agreed to. A test that wants to look at the
 * board asks for one, exactly as a person does, and the address it gets back is one the
 * server wrote - which is also what lets a test about sharing a link be about a link.
 *
 * The path is returned so a test can take a second page to the same board.
 */
export async function openBoard(page: Page): Promise<string> {
  const path = await createBoardPath(page.request);
  await page.goto(path);
  await expect(zoomLabel(page)).toHaveText('100%');
  await waitForRender(page);
  await expect(originMarker(page)).toBeInViewport();
  await expectMarkerAt(page, CENTRE);
  return path;
}

/**
 * Wait until the DOM has caught up with the camera state: camera updates are
 * batched onto an animation frame, so measurements must wait for that frame.
 */
export function waitForRender(page: Page): Promise<void> {
  return page
    .waitForFunction(
      () => {
        const hooks = window.__vidi6;
        const layer = document.querySelector<HTMLElement>('[data-testid="world-layer"]');
        if (!hooks || !layer) return false;
        const camera = hooks.getCamera();
        const matrix = new DOMMatrix(window.getComputedStyle(layer).transform);
        // Browsers report transform matrices rounded to about six significant
        // digits, so compare with a relative tolerance.
        const close = (a: number, b: number): boolean =>
          Math.abs(a - b) <= 1e-5 + 1e-5 * Math.max(Math.abs(a), Math.abs(b));
        return (
          close(matrix.a, camera.zoom) &&
          close(matrix.e, -camera.x * camera.zoom) &&
          close(matrix.f, -camera.y * camera.zoom)
        );
      },
      { timeout: 5_000 },
    )
    .then(() => undefined);
}

export async function markerCentre(page: Page): Promise<Point> {
  return originMarker(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

/** The camera the app holds, read from the test hook (test build only). */
export async function cameraState(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing: the e2e suite needs the test build');
    return hooks.getCamera();
  });
}

/** Teleport the camera (dragging a million pixels is not practical). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing: the e2e suite needs the test build');
    hooks.setCamera(next);
  }, camera);
  await waitForRender(page);
}

export async function readZoomPercent(page: Page): Promise<number> {
  const text = await zoomLabel(page).textContent();
  const percent = Number((text ?? '').replace('%', ''));
  if (!Number.isFinite(percent)) throw new Error(`unexpected zoom label: ${text}`);
  return percent;
}

/** The rendered dot grid: screen spacing and the phase of the lattice. */
export async function gridGeometry(page: Page): Promise<{ spacing: number; offsetX: number; offsetY: number }> {
  const geometry = await boardArea(page).evaluate((element) => {
    const style = window.getComputedStyle(element);
    const [sizeX = '', sizeY = ''] = style.backgroundSize.split(' ');
    const [posX = '', posY = ''] = style.backgroundPosition.split(' ');
    return {
      spacing: Number.parseFloat(sizeX),
      offsetY: Number.parseFloat(posY),
      offsetX: Number.parseFloat(posX),
      verticalSpacing: Number.parseFloat(sizeY),
    };
  });
  if (!Number.isFinite(geometry.spacing) || !Number.isFinite(geometry.offsetX) || !Number.isFinite(geometry.offsetY)) {
    throw new Error(`unreadable grid geometry: ${JSON.stringify(geometry)}`);
  }
  if (Math.abs(geometry.spacing - geometry.verticalSpacing) > 0.01) {
    throw new Error(`grid is not square: ${JSON.stringify(geometry)}`);
  }
  return { spacing: geometry.spacing, offsetX: geometry.offsetX, offsetY: geometry.offsetY };
}

/** The centre of the dot nearest to `point` (dots sit in the middle of tiles). */
export async function nearestDot(page: Page, point: Point): Promise<Point> {
  const { spacing, offsetX, offsetY } = await gridGeometry(page);
  const first = { x: offsetX + spacing / 2, y: offsetY + spacing / 2 };
  return {
    x: first.x + Math.round((point.x - first.x) / spacing) * spacing,
    y: first.y + Math.round((point.y - first.y) / spacing) * spacing,
  };
}

/** Drag with a real mouse: 200 px right and 100 px down from DRAG_FROM. */
export async function dragBoard(page: Page, delta: Point = DRAG, from: Point = DRAG_FROM): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await waitForRender(page);
}

/** Ctrl + wheel over a point: the board's zoom-at-pointer gesture. */
export async function ctrlWheel(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await waitForRender(page);
}

/** Plain wheel over a point: the board's scroll-to-pan gesture. */
export async function wheel(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, deltaY);
  await waitForRender(page);
}

/**
 * Scroll the board with the wheel and return the deltaY the page actually
 * received. Browsers scale wheel deltas by the device pixel ratio (a wheel of
 * 120 arrives as 60 on a 2x surface), so a test that claims "the board moved by
 * the wheel delta" has to measure the delivered delta instead of assuming it.
 */
export async function wheelBoard(page: Page, point: Point, deltaY: number): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __lastDeltaY?: number; __deltaHooked?: boolean };
    w.__lastDeltaY = undefined;
    if (!w.__deltaHooked) {
      w.__deltaHooked = true;
      const surface = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      surface?.addEventListener(
        'wheel',
        (event) => {
          w.__lastDeltaY = (event as WheelEvent).deltaY;
        },
        { capture: true, passive: true },
      );
    }
  });
  await wheel(page, point, deltaY);
  return page.evaluate(() => (window as unknown as { __lastDeltaY?: number }).__lastDeltaY ?? NaN);
}

/** Click Zoom in until it disables (returns the number of clicks). */
export async function clickZoomInUntilDisabled(page: Page): Promise<number> {
  let clicks = 0;
  while (clicks < 30) {
    if (!(await zoomInButton(page).isEnabled())) return clicks;
    await zoomInButton(page).click();
    clicks += 1;
    await waitForRender(page);
  }
  throw new Error('Zoom in never became disabled');
}

export async function clickZoomOutUntilDisabled(page: Page): Promise<number> {
  let clicks = 0;
  while (clicks < 40) {
    if (!(await zoomOutButton(page).isEnabled())) return clicks;
    await zoomOutButton(page).click();
    clicks += 1;
    await waitForRender(page);
  }
  throw new Error('Zoom out never became disabled');
}

/**
 * Click a zoom-control button through the DOM. For a disabled control
 * `HTMLElement.click()` does nothing at all (HTML spec), which is the point of
 * the test that uses it.
 */
export async function clickDisabledButton(page: Page, label: string): Promise<void> {
  await page.evaluate((ariaLabel) => {
    const button = document.querySelector<HTMLButtonElement>(
      `.zoom-controls button[aria-label="${ariaLabel}"]`,
    );
    if (!button) throw new Error(`no button labelled "${ariaLabel}"`);
    button.click();
  }, label);
}

/** Page-level state that must not change when the board handles a gesture. */
export interface PageZoomState {
  visualViewportScale: number | null;
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
}

export function pageZoomState(page: Page): Promise<PageZoomState> {
  return page.evaluate(() => ({
    visualViewportScale: window.visualViewport ? window.visualViewport.scale : null,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

/** Screenshot a square region of the page. */
/**
 * A screenshot of a square region, plus the CSS size it was taken at: on a 2x
 * surface the image has twice as many pixels as CSS pixels, so re-shooting the
 * same region later has to use the CSS size, not the pixel count.
 */
export interface Shot {
  image: Image;
  /** Centre of the region, in CSS pixels. */
  centre: Point;
  /** Side of the region, in CSS pixels. */
  size: number;
}

export async function shootRegion(page: Page, centre: Point, size = 60): Promise<Shot> {
  const clip = {
    x: Math.round(centre.x - size / 2),
    y: Math.round(centre.y - size / 2),
    width: size,
    height: size,
  };
  return { image: await decodePng(await page.screenshot({ clip })), centre, size };
}

/** Mean difference between a shot and the page region at `centre` + offset. */
export async function differenceAt(page: Page, shot: Shot, centre: Point, offset: Point): Promise<number> {
  const other = await shootRegion(page, { x: centre.x + offset.x, y: centre.y + offset.y }, shot.size);
  return meanDifference(shot.image, other.image);
}

/** Average lightness of the region around a point (dots are darker). */
export async function lightnessAt(page: Page, centre: Point, size = 12): Promise<number> {
  return meanLightness((await shootRegion(page, centre, size)).image);
}

/**
 * Darkest and lightest pixel in a square region of the rendered page: proves
 * the dot grid is really painted (dark grey dots on a near-white board).
 */
export async function pixelLightnessRange(
  page: Page,
  centre: Point,
  size = 12,
): Promise<[number, number]> {
  const image = (await shootRegion(page, centre, size)).image;
  let min = 255;
  let max = 0;
  for (let p = 0; p < image.width * image.height; p += 1) {
    const offset = p * image.channels;
    const lightness =
      ((image.data[offset] ?? 0) + (image.data[offset + 1] ?? 0) + (image.data[offset + 2] ?? 0)) / 3;
    min = Math.min(min, lightness);
    max = Math.max(max, lightness);
  }
  return [min, max];
}

/** Assert two points are the same within a tolerance in CSS pixels. */
export function expectNear(actual: number, expected: number, tolerance = 1, message?: string): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message ?? 'value'}: expected ${expected} \u00b1${tolerance}, got ${actual}`);
  }
}

export function expectPointNear(actual: Point, expected: Point, tolerance = 1, message?: string): void {
  expectNear(actual.x, expected.x, tolerance, `${message ?? 'point'}.x`);
  expectNear(actual.y, expected.y, tolerance, `${message ?? 'point'}.y`);
}

export async function expectMarkerAt(page: Page, point: Point, tolerance = 1): Promise<void> {
  await expect
    .poll(
      async () => {
        const centre = await markerCentre(page);
        return Math.max(Math.abs(centre.x - point.x), Math.abs(centre.y - point.y));
      },
      { message: `origin marker not at ${point.x},${point.y} \u00b1${tolerance}` },
    )
    .toBeLessThanOrEqual(tolerance);
}

export const mod = (value: number, period: number): number => {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
};
