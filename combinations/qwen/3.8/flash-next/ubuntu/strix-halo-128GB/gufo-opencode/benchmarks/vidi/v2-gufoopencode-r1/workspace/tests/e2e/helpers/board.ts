import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 800;

export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (box === null) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page): Promise<string> {
  const text = await page.getByTestId('zoom-label').textContent();
  return (text ?? '').trim();
}

export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

export async function setCamera(page: Page, next: Camera): Promise<void> {
  await page.evaluate((cam) => window.__vidi6!.setCamera(cam), next);
  await expect
    .poll(() => readCamera(page))
    .toEqual({ x: next.x, y: next.y, zoom: next.zoom });
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
}

export async function dragBoard(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

export async function gridComputedStyles(page: Page): Promise<{ backgroundSize: string; backgroundPosition: string }> {
  return page.getByTestId('dot-grid').evaluate((el) => {
    const style = getComputedStyle(el);
    return { backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition };
  });
}

export function parsePxPairs(value: string): Array<{ x: number; y: number }> {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/).map((n) => parseFloat(n)))
    .map(([x, y]) => ({ x, y }));
}
