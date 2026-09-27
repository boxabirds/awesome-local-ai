import { expect, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

/** The camera, as the running client holds it. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The laptop viewport every case runs in. */
export const VIEWPORT = { width: 1280, height: 800 };

/**
 * The known view: 100% with the board's starting point in the middle of the screen.
 * Exported so each e2e spec can start from a known view.
 */
export const INITIAL_CAMERA: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** Rendering tolerance in CSS pixels (sub-pixel text/layout rounding). */
export const PX = 1;

export const screenToWorld = (cam: Camera, p: Point): Point => ({
  x: p.x / cam.zoom + cam.x,
  y: p.y / cam.zoom + cam.y,
});

export const worldToScreen = (cam: Camera, p: Point): Point => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

const hookCall = async <T>(page: Page, body: string, arg?: unknown): Promise<T> =>
  page.evaluate(
    ({ src, value }) => {
      const w = window as unknown as { __vidi6?: Record<string, (v?: unknown) => unknown> };
      if (!w.__vidi6) throw new Error('window.__vidi6 is missing: build the client in test mode');
      // eslint-disable-next-line no-new-func
      return new Function('hooks', 'arg', src)(w.__vidi6, value) as T;
    },
    { src: body, value: arg },
  );

/** Load the board and wait until the camera hook (and therefore the app) is live. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as never as { __vidi6?: unknown }).__vidi6 === 'object');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
}

/** The camera the app is holding (test hook). */
export function readCamera(page: Page): Promise<Camera> {
  return hookCall<Camera>(page, 'return hooks.getCamera()');
}

/**
 * Jump the camera, for example a million pixels away. Waits until the DOM transform
 * and the camera attributes show the requested view, so a case never measures a
 * half-applied camera.
 */
export async function setCamera(page: Page, next: Camera): Promise<void> {
  await hookCall<void>(page, 'hooks.setCamera(arg)', next);
  const layer = page.getByTestId('world-layer');
  await expect(layer).toHaveAttribute('data-camera-x', String(next.x));
  await expect(layer).toHaveAttribute('data-camera-y', String(next.y));
  await expect(layer).toHaveAttribute('data-camera-zoom', String(next.zoom));
  await expect(layer).toHaveAttribute(
    'data-world-transform',
    `scale(${next.zoom}) translate(${-next.x}px, ${-next.y}px)`,
  );
}

/** Where the board's starting point (world 0,0) is painted on screen. */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('the origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The rendered camera, measured from the painted marker rather than from state. */
export async function measuredCamera(page: Page): Promise<Camera> {
  const hook = await readCamera(page);
  const centre = await markerCentre(page);
  return {
    x: screenToWorld(hook, centre).x,
    y: screenToWorld(hook, centre).y,
    zoom: hook.zoom,
  };
}

/** The zoom label text, exactly as rendered (e.g. `125%`). */
export function zoomLabel(page: Page): Promise<string> {
  return expect(page.getByTestId('zoom-label')).toHaveText(/^\d+%$/).then(
    () => page.getByTestId('zoom-label').innerText(),
  );
}

/** The dot grid as the browser computed it. */
export async function gridTile(page: Page): Promise<{ spacing: number; offsetX: number; offsetY: number }> {
  const read = await page.getByTestId('board-grid').evaluate((el) => {
    const style = getComputedStyle(el);
    const size = style.backgroundSize.split(' ').map((part) => parseFloat(part));
    const position = style.backgroundPosition.split(' ').map((part) => parseFloat(part));
    return {
      size: size[0] as number,
      positionX: position[0] as number,
      positionY: position[1] as number,
    };
  });
  return { spacing: read.size, offsetX: read.positionX, offsetY: read.positionY };
}

/** The nearest dot lattice position to a screen point. */
export function nearestDot(tile: { spacing: number; offsetX: number; offsetY: number }, p: Point): Point {
  const wrap = (value: number, offset: number): number => {
    const raw = (value - offset) % tile.spacing;
    const signed = raw < 0 ? raw + tile.spacing : raw;
    return signed > tile.spacing / 2 ? value + (signed - tile.spacing) : value - signed;
  };
  return { x: wrap(p.x, tile.offsetX), y: wrap(p.y, tile.offsetY) };
}

/** Distance between two screen points. */
export const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Press, move in steps, and release: a mouse drag on the empty board. */
export async function dragBoard(
  page: Page,
  from: Point,
  to: Point,
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

/** Ctrl + wheel (the browser page-zoom gesture) at a screen point. */
export async function ctrlWheelAt(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Click a zoom control by its accessible name (`Zoom in`, `Zoom out`, `Reset view`). */
export async function clickControl(page: Page, name: 'Zoom in' | 'Zoom out' | 'Reset view'): Promise<void> {
  await page.getByRole('button', { name }).click();
}

/**
 * Send a click to a control even when it is disabled. A normal click would wait
 * for the button to become enabled again, which never happens at a zoom limit.
 */
export async function forceClick(page: Page, name: 'Zoom in' | 'Zoom out' | 'Reset view'): Promise<void> {
  await page.getByRole('button', { name }).dispatchEvent('click');
}

/** How many times a control can still be clicked before it goes disabled. */
export async function clickUntilDisabled(
  page: Page,
  name: 'Zoom in' | 'Zoom out',
  limit = 40,
): Promise<number> {
  const button = page.getByRole('button', { name });
  let clicks = 0;
  for (; clicks < limit; clicks++) {
    if (await button.isDisabled()) break;
    await button.click();
  }
  if (clicks >= limit) throw new Error(`${name} never became disabled after ${limit} clicks`);
  return clicks;
}

/** The browser's own page-zoom signals. */
export function pageZoomSignals(page: Page): Promise<{ visualViewportScale: number; devicePixelRatio: number }> {
  return page.evaluate(() => ({
    visualViewportScale: window.visualViewport ? window.visualViewport.scale : 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

/** A number that stands a million pixels away from the start point. */
export const FAR = 1_000_000;

export { GRID_SPACING_WORLD, expect };
