import type { Locator, Page } from '@playwright/test';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** The label on the control that opens a fresh board from the home page. */
export const NEW_BOARD_LABEL = 'New board';

export async function gotoBoard(page: Page): Promise<void> {
  // Story 5: the root is the home page, and a board is created by the New board
  // button (opening an unknown `/b/:id` now shows Board not found). Clicking it
  // waits on the board API, then routes to the new board.
  await page.goto('/');
  await page.getByRole('button', { name: NEW_BOARD_LABEL }).click();
  // Wait for the board to open (test hook + camera-driven UI present).
  await page.waitForSelector('[data-board-surface]');
}

export function marker(page: Page): Locator {
  return page.locator('[data-origin-marker]');
}

/** Screen-space centre of the origin marker (== world (0,0)). */
export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await marker(page).boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabelValue(page: Page): Promise<number> {
  const text = await page.locator('.zoom-label').textContent();
  return parseInt((text ?? '0').replace('%', ''), 10);
}

export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.waitForFunction(() => typeof (window as any).__vidi6?.setCamera === 'function');
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
}

/** Grid cell size in screen px, read from the board surface background-size. */
export async function gridSizePx(page: Page): Promise<number> {
  return page.locator('[data-board-surface]').evaluate((el) => {
    const bs = getComputedStyle(el).backgroundSize; // e.g. "24px 24px"
    return parseFloat(bs);
  });
}

/** translate() values of the world layer, parsed from its inline transform. */
export async function worldTranslate(page: Page): Promise<{ tx: number; ty: number }> {
  return page.locator('.world-layer').evaluate((el) => {
    const t = (el as HTMLElement).style.transform; // scale(z) translate(Xpx, Ypx)
    // Browsers may serialise large px values in exponential notation (e.g. -1e+06px).
    const m = t.match(/translate\(\s*(-?[\d.eE+]+)\s*px\s*,\s*(-?[\d.eE+]+)\s*px\s*\)/);
    if (!m) throw new Error(`could not parse transform: ${t}`);
    return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
  });
}

export async function hintVisible(page: Page): Promise<boolean> {
  return (await page.locator('[data-navigation-hint]').count()) > 0;
}

export async function pageZoomScale(page: Page): Promise<number> {
  return page.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
}

export async function devicePixelRatio(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio);
}
