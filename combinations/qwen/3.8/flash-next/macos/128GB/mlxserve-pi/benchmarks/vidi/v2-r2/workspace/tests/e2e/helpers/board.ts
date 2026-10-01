// Board helpers for the e2e tests: locate the origin marker, read the zoom
// label and grid geometry, drive the pointer, and jump the camera with the
// test hook (dragging a million pixels is not practical).

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../../src/shared/config';

export { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, ZOOM_STEP_FACTOR };

export interface Point {
  x: number;
  y: number;
}
export interface BoardCamera {
  x: number;
  y: number;
  zoom: number;
}
/** Dot-grid geometry as the browser computed it (CSS pixels). */
export interface GridGeometry {
  /** Tile size, i.e. GRID_SPACING_WORLD * zoom. */
  spacing: number;
  /** Background offset of the tile grid. */
  offsetX: number;
  offsetY: number;
}

export const VIEWPORT = { width: 1280, height: 800 };
/** Tolerance the PRD allows for "the same place": one pixel. */
export const PIXEL_TOLERANCE = 1;

/**
 * Ask the service for a board of its own - the same call the New board button makes.
 *
 * Since story 5 an address does not create a board, so a test cannot arrive at a
 * board by inventing an id and navigating to it: it has to create one first, like
 * anyone who wants a board to work on. This goes over the HTTP API rather than by
 * any test-only route, because that creation is part of what is being tested.
 */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  if (!response.ok()) {
    throw new Error(`creating a board: HTTP ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id === '') {
    throw new Error(`creating a board: no id in the answer: ${JSON.stringify(body)}`);
  }
  return body.id;
}

/** Make a board and open it, for a test that wants a board and no address of its own. */
export async function openFreshBoard(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const id = await createBoard(request);
  await page.goto(`/b/${id}`);
  await expect(viewport(page)).toBeVisible();
  return id;
}

export function boardArea(page: Page): Locator {
  return page.getByTestId('board-area');
}
export function viewport(page: Page): Locator {
  return page.getByTestId('board-viewport');
}
/** The crosshair at the board's starting point (world 0,0). */
export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}
export function zoomLabelLocator(page: Page): Locator {
  return page.getByTestId('zoom-label');
}
export function hintLocator(page: Page): Locator {
  return page.getByTestId('nav-hint');
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

export async function zoomLabel(page: Page): Promise<string> {
  return (await zoomLabelLocator(page).textContent()) ?? '';
}

export async function readCamera(page: Page): Promise<BoardCamera> {
  return viewport(page).evaluate((el) => ({
    x: Number((el as HTMLElement).dataset.cameraX),
    y: Number((el as HTMLElement).dataset.cameraY),
    zoom: Number((el as HTMLElement).dataset.cameraZoom),
  }));
}

/**
 * The camera the board has finished rendering: waits until two reads agree, so
 * the frame a gesture was batched into has been applied.
 */
export async function settledCamera(page: Page): Promise<BoardCamera> {
  const painted = (camera: BoardCamera): boolean =>
    Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.zoom);
  let previous = await readCamera(page);
  for (let attempt = 0; attempt < 500; attempt++) {
    if (painted(previous)) {
      const next = await readCamera(page);
      if (painted(next) && next.x === previous.x && next.y === previous.y && next.zoom === previous.zoom) {
        return next;
      }
      previous = next;
    } else {
      previous = await readCamera(page);
    }
    await page.waitForTimeout(10);
  }
  throw new Error('the camera never settled');
}

/** Centre of the origin marker in viewport coordinates: world (0, 0). */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await originMarker(page).boundingBox();
  if (box === null) throw new Error('the origin marker is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Centre of the board area, where Reset view puts the board start point. */
export async function areaCentre(page: Page): Promise<Point> {
  const box = await boardArea(page).boundingBox();
  if (box === null) throw new Error('the board area is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function gridGeometry(page: Page): Promise<GridGeometry> {
  const css = await viewport(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
  const size = /([\d.]+)px/.exec(css.size);
  const position = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(css.position);
  if (size === null || position === null) {
    throw new Error(`unparsable grid CSS: ${JSON.stringify(css)}`);
  }
  return {
    spacing: Number(size[1]),
    offsetX: Number(position[1]),
    offsetY: Number(position[2]),
  };
}

/**
 * Centre of the grid dot nearest `p`, derived from the CSS the browser renders
 * with. Dots are drawn at the centre of each background tile.
 */
export function nearestDot(geom: GridGeometry, p: Point): Point {
  const baseX = geom.offsetX + geom.spacing / 2;
  const baseY = geom.offsetY + geom.spacing / 2;
  return {
    x: baseX + Math.round((p.x - baseX) / geom.spacing) * geom.spacing,
    y: baseY + Math.round((p.y - baseY) / geom.spacing) * geom.spacing,
  };
}

export function dotsAlong(geom: GridGeometry, axis: 'x' | 'y', from: number, to: number): number[] {
  const base = axis === 'x' ? geom.offsetX + geom.spacing / 2 : geom.offsetY + geom.spacing / 2;
  const out: number[] = [];
  for (let i = Math.ceil((from - base) / geom.spacing); ; i++) {
    const value = base + i * geom.spacing;
    if (value > to) break;
    if (value >= from) out.push(value);
  }
  return out;
}

/** Jump the camera with the test hook (only present in the test build). */
export async function setCamera(page: Page, camera: Partial<BoardCamera>): Promise<void> {
  const target = { x: 0, y: 0, zoom: 1, ...camera };
  // the hook is installed when the board mounts, which headless WebKit does a
  // frame after the load event
  await page.waitForFunction(
    () => typeof (window as unknown as { __vidi6?: { setCamera?: unknown } }).__vidi6?.setCamera === 'function',
  );
  await page.evaluate((cam) => {
    const api = (window as unknown as { __vidi6?: { setCamera(x: number, y: number, z: number): void } })
      .__vidi6;
    if (api === undefined) throw new Error('window.__vidi6 is missing: build with MODE=test');
    api.setCamera(cam.x, cam.y, cam.zoom);
  }, target);
  await expect.poll(() => readCamera(page), { timeout: 5_000 }).toMatchObject({
    x: expect.closeTo(target.x, 6),
    y: expect.closeTo(target.y, 6),
    zoom: expect.closeTo(target.zoom, 6),
  });
}

/** Press, move in steps, release: the board follows the pointer. */
export async function dragBoard(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Wheel/trackpad scroll over the board (no modifier: pans). */
export async function scrollBoard(page: Page, point: Point, deltaX: number, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(deltaX, deltaY);
}

/**
 * Ctrl/Cmd + wheel over the board: zoom. In Chromium this is dispatched
 * through CDP so it is a real, browser-level Ctrl+wheel (which the browser
 * would otherwise turn into page zoom); elsewhere a WheelEvent with ctrlKey is
 * dispatched into the page, which is what a trackpad pinch looks like to the
 * board. Either way the board must call preventDefault.
 */
export async function ctrlWheel(
  page: Page,
  point: Point,
  deltaY: number,
  browserName: string,
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: 0,
      deltaY,
      modifiers: 2, // Ctrl
    });
    await cdp.detach();
    return;
  }
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY,
        clientX: x,
        clientY: y,
      });
      target.dispatchEvent(event);
    },
    { x: point.x, y: point.y, deltaY },
  );
}

/** Watch whether the page (rather than the board) would consume a wheel event. */
export async function watchPrevented(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __wheelLog: { prevented: boolean; ctrl: boolean }[] }).__wheelLog = [];
    document.addEventListener(
      'wheel',
      (event) => {
        const log = (window as unknown as { __wheelLog: { prevented: boolean; ctrl: boolean }[] })
          .__wheelLog;
        log.push({ prevented: event.defaultPrevented, ctrl: event.ctrlKey });
      },
      { passive: false },
    );
  });
}

export async function wheelLog(page: Page): Promise<{ prevented: boolean; ctrl: boolean }[]> {
  return page.evaluate(
    () => (window as unknown as { __wheelLog?: { prevented: boolean; ctrl: boolean }[] }).__wheelLog ?? [],
  );
}

export interface PageZoom {
  scale: number;
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
}

/** The browser's own zoom of the page, which board gestures must never change. */
export async function pageZoom(page: Page): Promise<PageZoom> {
  return page.evaluate(() => ({
    scale: window.visualViewport === null ? 1 : window.visualViewport.scale,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

export function expectPixels(actual: number, expected: number, tolerance = PIXEL_TOLERANCE): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/**
 * The camera after a gesture: waits until it differs from `from` (the board
 * batches a gesture into the next frame, which headless WebKit can deliver a
 * frame late), and then until it stops moving.
 */
export async function waitForCameraChange(page: Page, from: BoardCamera): Promise<BoardCamera> {
  await expect
    .poll(
      async () => {
        const camera = await readCamera(page);
        return camera.x !== from.x || camera.y !== from.y || camera.zoom !== from.zoom;
      },
      { timeout: 5_000, message: 'the board to react to the gesture' },
    )
    .toBe(true);
  return settledCamera(page);
}

/** Wait for the rendered zoom label to change from `previous`. */
export async function zoomLabelChanged(page: Page, previous: string): Promise<string> {
  await expect
    .poll(async () => zoomLabel(page), { timeout: 5_000, message: `zoom label to leave ${previous}` })
    .not.toBe(previous);
  return zoomLabel(page);
}
