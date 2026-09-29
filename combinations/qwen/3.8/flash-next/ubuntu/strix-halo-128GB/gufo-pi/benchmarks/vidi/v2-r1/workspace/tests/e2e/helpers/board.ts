import { expect, type Page } from '@playwright/test';

import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_MIN } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';

export type { Camera };

/** Matches the viewport size configured in playwright.config.ts. */
export const BOARD_SIZE = { width: 1280, height: 800 };

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeVisible();
  // the e2e suite runs against a `--mode test` build, which is the only build
  // that carries the test hook
  await expect
    .poll(() =>
      page.evaluate(() => typeof window.__vidi6?.getCamera === 'function'),
    )
    .toBe(true);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing; build with --mode test');
    return hooks.getCamera();
  });
}

/**
 * Jump the camera somewhere (used to travel a million units without dragging a
 * million pixels), and wait until that camera is the one on screen.
 */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((value) => window.__vidi6?.setCamera(value), camera);
  await expect
    .poll(async () => {
      const current = await getCamera(page);
      return (
        current.x === camera.x && current.y === camera.y && current.zoom === camera.zoom
      );
    })
    .toBe(true);
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

/**
 * Where the board's starting point (world 0,0) shows up on screen, in CSS
 * pixels relative to the viewport. The marker's own box is empty, so the centre
 * of its rect is exactly that point - read straight from
 * `getBoundingClientRect` for sub-pixel precision.
 */
/** Wait for the marker to be rendered within `tolerance` px of `point`. */
export async function expectMarkerAt(
  page: Page,
  point: { x: number; y: number },
  tolerance = 1,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const marker = await markerCentre(page);
        return Math.max(Math.abs(marker.x - point.x), Math.abs(marker.y - point.y));
      },
      { message: `the origin marker should land within ${tolerance}px of ${point.x}, ${point.y}` },
    )
    .toBeLessThanOrEqual(tolerance);
}

export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const rect = await page
    .getByTestId('origin-marker')
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  return rect;
}

/** Drag the empty board from a point by a screen delta, in several steps. */
export async function dragBoard(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (delta.x * i) / steps, from.y + (delta.y * i) / steps);
  }
  await page.mouse.up();
}

/** A trackpad pinch or a Ctrl/Cmd + wheel over the board. */
export async function pinchAt(page: Page, at: { x: number; y: number }, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

export interface BoardSurfaceStyle {
  /** Dot-grid spacing on screen, in CSS pixels. */
  readonly spacingX: number;
  readonly spacingY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The rendered dot grid: computed background size and position. */
export async function boardSurfaceStyle(page: Page): Promise<BoardSurfaceStyle> {
  const style = await page.getByTestId('viewport').evaluate((element) => {
    const computed = getComputedStyle(element);
    return { size: computed.backgroundSize, position: computed.backgroundPosition };
  });
  // a background shorthand can hold several comma separated layers, each with an
  // x and a y value; the board has a single layer
  const values = (css: string): number[] =>
    css.split(',').flatMap((layer) => layer.trim().split(/\s+/).map(Number.parseFloat));
  const [spacingX = Number.NaN, spacingY = spacingX] = values(style.size);
  const [offsetX = Number.NaN, offsetY = offsetX] = values(style.position);
  return { spacingX, spacingY, offsetX, offsetY };
}

export interface PageZoomState {
  readonly scale: number;
  readonly devicePixelRatio: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

/** Anything a browser page zoom would change. */
export async function pageZoomState(page: Page): Promise<PageZoomState> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

export function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** The grid spacing the board must render for a camera. */
export function expectedGridSpacing(camera: Camera): number {
  return GRID_SPACING_WORLD * camera.zoom;
}

export { ZOOM_MAX, ZOOM_MIN };
