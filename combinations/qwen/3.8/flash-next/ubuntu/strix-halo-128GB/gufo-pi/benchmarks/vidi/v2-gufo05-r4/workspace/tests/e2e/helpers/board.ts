/**
 * E2E helpers: the origin marker is the board's own pixel target, the zoom
 * label is the zoom readout, and `window.__vidi6` jumps the camera (test builds
 * only) so a test can travel UNBOUNDED_PAN_TESTED_EXTENT units without dragging
 * a million pixels.
 */

import { expect, type Page } from '@playwright/test';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../../src/shared/config';

export const BOARD_SIZE: Size = { width: 1280, height: 800 };
export const BOARD_CENTRE: Point = { x: BOARD_SIZE.width / 2, y: BOARD_SIZE.height / 2 };

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-vidi6="viewport"]')).toBeVisible();
}

export function marker(page: Page) {
  return page.getByTestId('origin-marker');
}

/** Screen-space centre of the board's starting point, in CSS pixels. */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await marker(page).boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}


/** The zoom readout, as a locator so assertions auto-wait for the board. */
export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-percent');
}

export async function getCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error('window.__vidi6 test hook is not available in this build');
  return camera;
}

/** Move the camera somewhere directly, then wait for the board to show it. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => window.__vidi6?.setCamera(next), camera);
  await expect
    .poll(() => getCamera(page), { message: `camera should become ${JSON.stringify(camera)}` })
    .toEqual(camera);
}

/** Pan far away and zoom in, so Reset view has something to undo. */
export async function goToFarAwayMaxZoom(page: Page): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX
  });
}

/** Drag the board with a real mouse, from one screen point to another. */
export async function dragBoard(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 4;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
  await page.mouse.up();
}

/** Ctrl/Cmd + wheel (a trackpad pinch) at a screen point. */
export async function pinchAt(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Computed background geometry of the dot grid. */
export async function gridStyle(page: Page): Promise<{ size: string; position: string }> {
  return page.locator('[data-vidi6="viewport"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
}

/** How big the zoom control renders — proof the browser page zoom did not change. */
export async function zoomControlBox(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.locator('[data-vidi6="zoom-controls"]').boundingBox();
  if (!box) throw new Error('zoom control has no bounding box');
  return { width: box.width, height: box.height };
}

/** Page-level zoom signals that must never change when the board zooms. */
export async function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio
  }));
}
