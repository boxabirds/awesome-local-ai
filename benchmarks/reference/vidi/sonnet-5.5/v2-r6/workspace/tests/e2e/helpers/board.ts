import type { Locator, Page } from '@playwright/test';

export const viewportOf = (page: Page): Locator => page.getByTestId('board-viewport');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByRole('status');

export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function readZoomPercent(page: Page): Promise<number> {
  return parseInt((await zoomLabel(page).textContent()) ?? '', 10);
}

/** Waits for the rAF-batched camera update to render. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate((cam) => window.__vidi6!.setCamera(cam), { x, y, zoom });
  await nextFrames(page);
}

/** Grid state: tile size and the screen position of a grid dot (tile centre). */
export async function gridState(page: Page): Promise<{ spacing: number; dotX: number; dotY: number }> {
  return viewportOf(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    const [sx] = cs.backgroundSize.split(' ').map(parseFloat);
    const [px, py] = cs.backgroundPosition.split(' ').map(parseFloat);
    return { spacing: sx, dotX: px + sx / 2, dotY: py + sx / 2 };
  });
}

/** Distance between two dot positions along one axis, folded into (-spacing/2, spacing/2]. */
export function foldedDelta(a: number, b: number, spacing: number): number {
  let d = (b - a) % spacing;
  if (d > spacing / 2) d -= spacing;
  if (d <= -spacing / 2) d += spacing;
  return d;
}
