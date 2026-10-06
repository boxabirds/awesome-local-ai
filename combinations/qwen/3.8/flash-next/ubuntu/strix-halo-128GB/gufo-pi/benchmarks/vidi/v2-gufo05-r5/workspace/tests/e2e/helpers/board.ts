import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

/**
 * E2E helpers for the board: locating the origin marker, reading the zoom label and
 * moving the camera through the test-only `window.__vidi6` hook (test builds only).
 */

/** Reads the live camera through the test-only hook (build with `vite build --mode test`). */
export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 is missing: build the client with `vite build --mode test`');
    }
    return window.__vidi6.getCamera();
  });
}

/**
 * Jumps the camera somewhere, and waits until the screen shows it.
 *
 * Camera updates are coalesced into a frame: the state moves at once, the drawing follows in the
 * next one. Waiting for the state alone is enough while the machine is idle and sees the frame
 * before the new camera when it is busy, which is the kind of failure that only happens in a full
 * parallel run. The three attributes of the viewport are what the drawing was made from.
 */
export async function setCamera(page: Page, want: Camera): Promise<void> {
  await page.evaluate((cam) => window.__vidi6?.setCamera(cam), want);
  await expect
    .poll(() => getCamera(page), { message: `camera should become ${JSON.stringify(want)}` })
    .toEqual(want);
  const viewport = page.getByTestId('board-viewport');
  await expect(viewport).toHaveAttribute('data-camera-x', String(want.x));
  await expect(viewport).toHaveAttribute('data-camera-y', String(want.y));
  await expect(viewport).toHaveAttribute('data-camera-zoom', String(want.zoom));
}

/** Centre of the origin marker: a stable pixel target for world point (0,0). */
export async function originOnScreen(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom indicator text, e.g. "125%". */
export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-percent').innerText()).trim();
}

/** The rendered dot-grid spacing in CSS pixels. */
export async function gridSpacingPx(page: Page): Promise<number> {
  const size = await page
    .getByTestId('board-viewport')
    .evaluate((el) => getComputedStyle(el).backgroundSize);
  const first = Number.parseFloat(size.split(' ')[0] ?? '');
  if (!Number.isFinite(first)) throw new Error(`unexpected background-size: ${size}`);
  return first;
}

/** The rendered dot-grid phase in CSS pixels. */
export async function gridPositionPx(page: Page): Promise<{ x: number; y: number }> {
  const position = await page
    .getByTestId('board-viewport')
    .evaluate((el) => getComputedStyle(el).backgroundPosition);
  const [x = '0', y = '0'] = position.split(' ');
  return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
}

/** Browser page-zoom signals: nothing on the board may change these. */
export async function pageScale(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}

/** Press, move in several steps, release: a plain pointer drag on the board. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Waits until the camera stops changing, then returns it (inertia-free, so this is quick). */
export async function cameraSettled(page: Page): Promise<Camera> {
  let previous = await getCamera(page);
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(60);
    const current = await getCamera(page);
    if (current.x === previous.x && current.y === previous.y && current.zoom === previous.zoom) {
      return current;
    }
    previous = current;
  }
  return previous;
}
