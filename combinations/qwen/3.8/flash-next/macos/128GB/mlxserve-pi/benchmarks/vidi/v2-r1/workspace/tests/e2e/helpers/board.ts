import { expect, type Locator, type Page } from '@playwright/test';
import { ZOOM_MAX, ZOOM_MIN } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';

/** Viewport size configured in playwright.config.ts. */
export const VIEWPORT = { width: 1280, height: 800 };

/** Open the board and wait for it to be interactive. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await settle(page);
}

/**
 * Wait for the board to finish applying its pending camera update (updates are
 * coalesced into one requestAnimationFrame) so DOM reads are deterministic.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
}

/** The camera the board is using, through the test-only hook. */
export async function readCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error('window.__vidi6 test hook is not available');
  return camera;
}

/** Jump the camera anywhere on the board (test hook). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((value) => {
    if (!window.__vidi6) throw new Error('window.__vidi6 test hook is not available');
    window.__vidi6.setCamera(value);
  }, camera);
  await settle(page);
  await expect.poll(() => readCamera(page), { timeout: 5_000 }).toEqual(camera);
}

/** Camera centred on the board's starting point at 100%, i.e. the standard view. */
export const STANDARD_VIEW: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** Centre of the origin crosshair (the stable pixel target for e2e). */
export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="origin-marker"]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!centre) throw new Error('origin marker is not rendered');
  return centre;
}

/** The dot grid as the browser has it: tile size and offset in CSS pixels. */
export async function gridStyle(page: Page): Promise<{
  size: { width: number; height: number };
  position: { x: number; y: number };
}> {
  const style = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="board-viewport"]');
    if (!element) return null;
    const computed = getComputedStyle(element);
    const parse = (value: string): number[] =>
      value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
    const size = parse(computed.backgroundSize);
    const position = parse(computed.backgroundPosition);
    return {
      size: { width: size[0] ?? 0, height: size[1] ?? 0 },
      position: { x: position[0] ?? 0, y: position[1] ?? 0 },
    };
  });
  if (!style) throw new Error('board viewport is not rendered');
  return style;
}

export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-level');

export const zoomInButton = (page: Page): Locator => page.getByTestId('zoom-in');

export const zoomOutButton = (page: Page): Locator => page.getByTestId('zoom-out');

export const resetButton = (page: Page): Locator => page.getByTestId('reset-view');

export const boardViewport = (page: Page): Locator => page.getByTestId('board-viewport');

export const hint = (page: Page): Locator => page.getByTestId('navigation-hint');

/** Read the zoom percentage out of the label. */
export async function readZoomPercent(page: Page): Promise<number> {
  const text = (await zoomLabel(page).textContent()) ?? '';
  return Number.parseInt(text, 10);
}

/** The browser's own page zoom, which the board must never change. */
export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}

/** Zoom limits as the test suite expects them. */
export const LIMITS = { min: ZOOM_MIN, max: ZOOM_MAX };
