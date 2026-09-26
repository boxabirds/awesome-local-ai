import { expect, type Page } from '@playwright/test';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

declare global {
  interface Window {
    __vidi6?: {
      getCamera(): Camera;
      setCamera(c: Camera): void;
      reset(): void;
      zoomStep(dir: 'in' | 'out'): void;
    };
  }
}

/** Load the board and wait until the app has mounted (test hook present). */
export async function openBoard(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__vidi6 != null, null, { timeout: 15_000 });
}

export function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
}

/** Centre of the origin crosshair (the stable pixel target). */
export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom percentage label text, e.g. "150%". */
export async function zoomLabel(page: Page): Promise<string | null> {
  return page.getByTestId('zoom-controls').locator('output').textContent();
}

/** The computed dot-grid spacing in CSS pixels (from background-size). */
export async function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const size = getComputedStyle(el).backgroundSize; // e.g. "48px 48px"
    return parseFloat(size.split(' ')[0]);
  });
}

export async function visualScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

export async function expectPixelClose(actual: number, expected: number, tol = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}
