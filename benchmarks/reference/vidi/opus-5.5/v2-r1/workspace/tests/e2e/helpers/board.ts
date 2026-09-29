import { type Locator, type Page, expect } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Creates a new board from the home page (New board) and waits until it is shown. */
export async function openBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(originMarker(page)).toBeAttached();
  await page.waitForFunction(() => !!window.__vidi6?.getCamera && !!window.__vidi6?.getNotes);
}

export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const viewport = (page: Page): Locator => page.getByTestId('board-viewport');
export const zoomLabel = (page: Page): Locator => page.locator('output.zoom-label');

/** Centre of the origin marker (world 0,0) in page pixels. */
export async function originPosition(page: Page) {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera!());
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => window.__vidi6!.setCamera!(c), cam);
  await page.waitForFunction((c) => {
    const t = document.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
    return t.includes(`scale(${c.zoom})`);
  }, cam);
}

/** Grid spacing and the page position of the grid dot nearest the viewport's top-left. */
export async function gridState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
    const style = getComputedStyle(el);
    const size = parseFloat(style.backgroundSize.split(' ')[0]);
    const [px, py] = style.backgroundPosition.split(' ').map((v) => parseFloat(v));
    // The dot sits at the centre of each background tile.
    return { spacing: size, dot: { x: px + size / 2, y: py + size / 2 } };
  });
}

export function expectedSpacing(zoom: number) {
  return GRID_SPACING_WORLD * zoom;
}

/** Page zoom indicators that must never change. */
export async function pageZoom(page: Page) {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    controlsWidth: document.querySelector('.zoom-controls')!.getBoundingClientRect().width,
  }));
}

export async function waitForFrame(page: Page) {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await waitForFrame(page);
}

export async function getNotes(page: Page) {
  return page.evaluate(() => window.__vidi6!.getNotes!());
}

export const notes = (page: Page): Locator => page.getByRole('group', { name: 'Sticky note' });
export const noteEditor = (page: Page): Locator => page.getByRole('textbox', { name: 'Note text' });

/** Page-pixel box of an element; throws when it is not rendered. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  return box;
}

export function centreOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The sticky note id drawn topmost at a page point. */
export async function noteIdAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) =>
      document.elementFromPoint(px, py)?.closest<HTMLElement>('[data-sticky-id]')?.dataset
        .stickyId ?? null,
    [x, y] as const,
  );
}
