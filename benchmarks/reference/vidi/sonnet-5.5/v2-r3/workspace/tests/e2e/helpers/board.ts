import type { Locator, Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
}

export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.locator('output');

export async function originCentre(page: Page): Promise<Box> {
  const b = await originMarker(page).boundingBox();
  if (!b) throw new Error('origin marker not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Grid state read from the viewport's computed background. Dots sit at (pos + size/2) mod size. */
export async function gridState(page: Page) {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = getComputedStyle(el);
    const [sx] = s.backgroundSize.split(' ');
    const [px, py] = s.backgroundPosition.split(' ');
    return { size: parseFloat(sx), x: parseFloat(px), y: parseFloat(py) };
  });
}

export async function setCamera(page: Page, x: number, y: number, zoom: number) {
  await page.evaluate(([cx, cy, cz]) => window.__vidi6!.setCamera({ x: cx, y: cy, zoom: cz }), [x, y, zoom]);
}

export async function drag(page: Page, from: Box, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
