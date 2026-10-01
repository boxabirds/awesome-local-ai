import type { Locator, Page } from '@playwright/test';

export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const b = (await originMarker(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function zoomLabel(page: Page): Locator {
  return page.locator('output');
}

export async function zoomValue(page: Page): Promise<number> {
  return parseInt((await zoomLabel(page).textContent()) ?? '', 10);
}

/** Grid geometry read from the viewport's computed background; dots are at the centre of each tile. */
export async function gridInfo(page: Page): Promise<{ spacing: number; dotX: number; dotY: number }> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const cs = getComputedStyle(el);
    const spacing = parseFloat(cs.backgroundSize.split(' ')[0]);
    const [px, py] = cs.backgroundPosition.split(' ').map(parseFloat);
    return { spacing, dotX: px + spacing / 2, dotY: py + spacing / 2 };
  });
}

/** Screen position of the grid dot nearest the middle of the screen. */
export async function dotNearCentre(page: Page): Promise<{ x: number; y: number }> {
  const g = await gridInfo(page);
  const vp = page.viewportSize()!;
  const snap = (dot: number, target: number) => dot + Math.round((target - dot) / g.spacing) * g.spacing;
  return { x: snap(g.dotX, vp.width / 2), y: snap(g.dotY, vp.height / 2) };
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), { x, y, zoom });
}
