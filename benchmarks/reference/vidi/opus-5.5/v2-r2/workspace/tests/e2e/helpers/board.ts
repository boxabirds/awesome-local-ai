import { type Page, expect } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export async function openBoard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await page.waitForFunction(() => !!window.__vidi6);
}

/** Centre of the origin crosshair (world 0,0) in page pixels. */
export async function originMarkerCentre(page: Page) {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page) {
  return page.getByRole('status');
}

export async function setCamera(page: Page, camera: Camera) {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), camera);
  await page.waitForFunction(
    (c) => {
      const cam = window.__vidi6?.getCamera();
      return cam && cam.x === c.x && cam.y === c.y && cam.zoom === c.zoom;
    },
    camera,
  );
  await nextFrames(page);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const cam = window.__vidi6?.getCamera();
    if (!cam) throw new Error('no test hook');
    return { x: cam.x, y: cam.y, zoom: cam.zoom };
  });
}

/** Wait for pending requestAnimationFrame camera flushes to render. */
export async function nextFrames(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Grid background geometry as rendered: tile size and offset in px. */
export async function gridGeometry(page: Page) {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = getComputedStyle(el);
    const [size] = s.backgroundSize.split(' ').map(parseFloat);
    const [offsetX, offsetY] = s.backgroundPosition.split(' ').map(parseFloat);
    return { size, offsetX, offsetY };
  });
}

export async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await nextFrames(page);
}

export async function pageZoomState(page: Page) {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    controlFontSize: getComputedStyle(document.querySelector('.zoom-controls-label')!).fontSize,
  }));
}

/** Difference between two grid offsets, modulo the tile size, in (-size/2, size/2]. */
export function modularDelta(a: number, b: number, size: number) {
  let d = (b - a) % size;
  if (d > size / 2) d -= size;
  if (d <= -size / 2) d += size;
  return d;
}
