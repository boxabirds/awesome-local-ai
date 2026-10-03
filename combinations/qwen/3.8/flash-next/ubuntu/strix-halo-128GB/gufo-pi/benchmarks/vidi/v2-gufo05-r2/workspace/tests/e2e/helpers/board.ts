import { expect, type Page } from '@playwright/test';

import type { Camera } from '../../../src/client/canvas/camera';

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

export interface BoardGridStyle {
  /** Dot grid spacing in screen pixels (both axes). */
  readonly spacingX: number;
  readonly spacingY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const VIEWPORT_SIZE = { width: 1280, height: 800 };

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('origin-marker')).toBeVisible();
}

export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    const hooks = (
      window as unknown as { __vidi6?: { setCamera(camera: Camera): void } }
    ).__vidi6;
    if (!hooks) {
      throw new Error(
        'window.__vidi6 is missing: e2e needs a test build (`npm run build:test`)',
      );
    }
    hooks.setCamera(next);
  }, camera);
  await expectNoPendingCameraFrame(page);
}

/**
 * Camera updates are coalesced into an animation frame; waiting for a couple of
 * frames makes subsequent reads deterministic.
 */
export async function expectNoPendingCameraFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Screen position of the board's starting point (world 0,0). */
export async function markerCenter(page: Page): Promise<Pixel> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('the origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page): Promise<string> {
  const text = await page.getByTestId('zoom-label').textContent();
  return (text ?? '').trim();
}

export async function zoomValue(page: Page): Promise<number> {
  const label = await zoomLabel(page);
  return Number(label.replace('%', ''));
}

export function zoomInButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetViewButton(page: Page) {
  return page.getByRole('button', { name: 'Reset view' });
}

export function navigationHint(page: Page) {
  return page.getByTestId('navigation-hint');
}

export async function gridStyle(page: Page): Promise<BoardGridStyle> {
  const read = await page.getByTestId('board-viewport').evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
  const numbers = (value: string): number[] =>
    (value.match(/-?[\d.]+/g) ?? []).map(Number);
  const size = numbers(read.size);
  const position = numbers(read.position);
  if (size.length < 2 || position.length < 2) {
    throw new Error(`unexpected grid style: ${JSON.stringify(read)}`);
  }
  return {
    spacingX: size[0] as number,
    spacingY: size[1] as number,
    offsetX: position[0] as number,
    offsetY: position[1] as number,
  };
}

/** Drag the board with a real mouse from one screen point to another. */
export async function dragBoard(
  page: Page,
  from: Pixel,
  to: Pixel,
  options: { steps?: number } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 5 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}

/** Ctrl + wheel over a screen point (trackpad pinch arrives the same way). */
export async function ctrlWheel(page: Page, at: Pixel, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await expectNoPendingCameraFrame(page);
}

export async function pageZoomScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

export function withinTolerance(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
