import type { Locator, Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page): Locator {
  return page.locator('output');
}

export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Wait for the rendered transform to settle on the camera the hook currently holds. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Grid state read from the rendered CSS: tile size and screen position of one dot. */
export async function gridInfo(page: Page): Promise<{ spacing: number; dotX: number; dotY: number }> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = (el as HTMLElement).style;
    const [w] = s.backgroundSize.split(' ');
    const [px, py] = s.backgroundPosition.split(' ');
    const spacing = parseFloat(w);
    return { spacing, dotX: parseFloat(px) + spacing / 2, dotY: parseFloat(py) + spacing / 2 };
  });
}

/** Signed distance of `value` from the nearest dot column/row of a grid, in px. */
export function offGrid(value: number, dot: number, spacing: number): number {
  const d = (((value - dot) % spacing) + spacing) % spacing;
  return Math.min(d, spacing - d);
}

export const GRID_WORLD = GRID_SPACING_WORLD;
