import type { Locator, Page } from '@playwright/test';

export const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export async function originCentre(page: Page) {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page): Locator {
  return page.locator('output');
}

export async function setCamera(page: Page, camera: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), camera);
}

/** Grid state read from the viewport's computed background (dots sit at tile centres). */
export async function gridState(page: Page) {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = getComputedStyle(el);
    const [px, py] = s.backgroundPosition.split(' ').map(parseFloat);
    const [sx, sy] = s.backgroundSize.split(' ').map(parseFloat);
    return { px, py, sx, sy };
  });
}

/** Screen position of a visible dot: the tile centre within the first tile. */
export function dotPosition(g: { px: number; py: number; sx: number; sy: number }) {
  return { x: g.px + g.sx / 2, y: g.py + g.sy / 2 };
}
