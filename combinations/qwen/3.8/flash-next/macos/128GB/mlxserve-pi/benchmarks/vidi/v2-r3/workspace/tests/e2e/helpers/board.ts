import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * Load the board and wait until the app has fully initialised (the test
 * hook installed and the start point centred), so test-driven camera sets
 * never race the app's own one-time centring.
 */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(zoomLabel(page)).toHaveText('100%');
  await page.waitForFunction(
    () =>
      window.__vidi6 !== undefined &&
      window.__vidi6.getCamera().x === -window.innerWidth / 2 &&
      window.__vidi6.getCamera().y === -window.innerHeight / 2,
  );
  await settle(page);
}

/**
 * Wait until the rendered world-layer transform matches the camera state.
 * The app coalesces camera updates into one animation frame and WebKit's
 * CDP reads can lag input handling, so geometry must not be measured from
 * a stale frame.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const cam = window.__vidi6?.getCamera();
    const el = document.querySelector('[data-testid="world-layer"]');
    if (cam === undefined || el === null) return false;
    const t = getComputedStyle(el).transform;
    const m = t === 'none' ? new DOMMatrix() : new DOMMatrixReadOnly(t);
    return (
      Math.abs(m.a - cam.zoom) < 1e-3 &&
      Math.abs(m.e + cam.x * cam.zoom) <= 0.5 &&
      Math.abs(m.f + cam.y * cam.zoom) <= 0.5
    );
  });
}

export function zoomLabel(page: Page) {
  return page.locator('[data-testid="zoom-label"]');
}

export function hint(page: Page) {
  return page.locator('[data-testid="navigation-hint"]');
}

export function originMarker(page: Page) {
  return page.locator('[data-testid="origin-marker"]');
}

/** Test-build-only crosshair at world (UNBOUNDED_PAN_TESTED_EXTENT, ...). */
export function farMarker(page: Page) {
  return page.locator('[data-testid="far-marker"]');
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export async function centerOf(page: Page, marker: ReturnType<Page['locator']>): Promise<ScreenPoint> {
  await settle(page); // never measure a stale render
  const box = await marker.boundingBox();
  if (box === null) throw new Error('marker has no bounding box (not rendered?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function originCenter(page: Page): Promise<ScreenPoint> {
  return centerOf(page, originMarker(page));
}

export function farCenter(page: Page): Promise<ScreenPoint> {
  return centerOf(page, farMarker(page));
}

/** Jump the camera directly (test-mode build only). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((c) => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 missing: e2e must run against `vite build --mode test`');
    }
    window.__vidi6.setCamera(c);
  }, camera);
}

export function backgroundSize(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('[data-testid="board-viewport"]')!).backgroundSize,
  );
}

export function pageZoomState(page: Page): Promise<{ dpr: number; scale: number }> {
  return page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    scale: window.visualViewport?.scale ?? 1,
  }));
}

/** Drag the board by (dx, dy) screen pixels from a point of empty board. */
export async function dragBoard(page: Page, from: ScreenPoint, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

/**
 * Assert the marker centre moved by exactly (dx, dy) screen pixels, polling
 * because camera renders are coalesced into one animation frame.
 */
export async function expectMoved(
  page: Page,
  before: ScreenPoint,
  dx: number,
  dy: number,
  center: (p: Page) => Promise<ScreenPoint>,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const c = await center(page);
        return Math.max(Math.abs(c.x - before.x - dx), Math.abs(c.y - before.y - dy));
      },
      { timeout: 3000 },
    )
    .toBeLessThanOrEqual(1);
}

/** Assert a marker centre sits at a screen point (within 1 px), polling. */
export async function expectCenterAt(
  page: Page,
  target: ScreenPoint,
  center: (p: Page) => Promise<ScreenPoint>,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const c = await center(page);
        return Math.max(Math.abs(c.x - target.x), Math.abs(c.y - target.y));
      },
      { timeout: 3000 },
    )
    .toBeLessThanOrEqual(1);
}
