import { expect, type Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';

/** Shared helpers for the board e2e tests. */

export const VIEWPORT_SIZE = { width: 1280, height: 800 };

export function viewport(page: Page) {
  return page.getByTestId('viewport');
}

export function originMarker(page: Page) {
  return page.getByTestId('origin-marker');
}

export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page) {
  return page.getByTestId('zoom-in');
}

export function zoomOutButton(page: Page) {
  return page.getByTestId('zoom-out');
}

export function resetButton(page: Page) {
  return page.getByTestId('reset-view');
}

export function hint(page: Page) {
  return page.getByTestId('navigation-hint');
}

/** Centre of the origin marker, in page pixels: the screen position of world (0,0). */
export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Zoom label as a number, e.g. "125%" -> 125. */
export async function zoomPercentLabel(page: Page): Promise<number> {
  const text = (await zoomLabel(page).innerText()).trim();
  const match = /^(-?\d+)%$/.exec(text);
  if (!match) throw new Error(`zoom label is not a percentage: "${text}"`);
  return Number(match[1]);
}

/** The camera the app is holding, read from the rendered world layer. */
export async function cameraFromDom(page: Page): Promise<Camera> {
  return page.getByTestId('world-layer').evaluate((el) => ({
    x: Number((el as HTMLElement).dataset.cameraX),
    y: Number((el as HTMLElement).dataset.cameraY),
    zoom: Number((el as HTMLElement).dataset.cameraZoom),
  }));
}

/** Jump the camera anywhere (test build only; see window.__vidi6). */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    const api = (window as unknown as {
      __vidi6?: { setCamera(x: number, y: number, zoom: number): void };
    }).__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing: not a test build');
    api.setCamera(x, y, zoom);
  }, cam);
  await expect.poll(() => cameraFromDom(page)).toEqual(cam);
}

/** Dot-grid spacing currently painted, in screen pixels. */
export async function gridSpacingPx(page: Page): Promise<number> {
  const value = await viewport(page).evaluate((el) => {
    const size = getComputedStyle(el as HTMLElement).backgroundSize;
    const first = size.split(',')[0] ?? '';
    return Number.parseFloat(first.trim());
  });
  if (!Number.isFinite(value)) throw new Error(`unreadable background-size: ${value}`);
  return value;
}

/** Dot-grid phase (background-position x/y), in screen pixels. */
export async function gridOffsetPx(page: Page): Promise<{ x: number; y: number }> {
  return viewport(page).evaluate((el) => {
    const position = getComputedStyle(el as HTMLElement).backgroundPosition;
    const [x = '0px', y = '0px'] = position.split(' ');
    return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
  });
}

export async function expectGridSpacingMatchesCamera(page: Page): Promise<void> {
  const [spacing, cam] = await Promise.all([gridSpacingPx(page), cameraFromDom(page)]);
  expect(Math.abs(spacing - GRID_SPACING_WORLD * cam.zoom)).toBeLessThan(0.5);
}

/** Browser page-zoom indicators, which board gestures must never change. */
export async function pageZoomState(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}

/** Wait for the app to render its board. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(viewport(page)).toBeVisible();
  await expect(originMarker(page)).toBeVisible();
  await waitForRender(page);
}

/** Let two animation frames pass so any batched camera update has rendered. */
export async function waitForRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Click a zoom button and wait for the percentage label to react, so the
 * frame-batched camera update cannot race the next assertion.
 */
export async function clickAndWaitForZoomChange(
  page: Page,
  button: ReturnType<typeof zoomInButton>,
): Promise<number> {
  const before = await zoomPercentLabel(page);
  await button.click();
  await expect
    .poll(() => zoomPercentLabel(page), { timeout: 5_000 })
    .not.toBe(before);
  return zoomPercentLabel(page);
}

/** Read the camera after waiting for a render, so nothing is in flight. */
export async function settledCamera(page: Page): Promise<Camera> {
  await waitForRender(page);
  return cameraFromDom(page);
}
