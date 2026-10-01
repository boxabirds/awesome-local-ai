import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import { GRID_SPACING_WORLD, PERCENT } from '../../../src/shared/config';

const HOOK_SELECT_ERROR = 'window.__vidi6 is missing (build the client with `npm run build:test`)';

/** Load the board by creating one via API and navigating to it. */
export async function openBoard(page: Page): Promise<void> {
  // Create a board via the API
  const res = await page.request.post('/api/boards');
  if (!res.ok()) throw new Error(`Failed to create board: ${res.status()}`);
  const { id } = await res.json() as { id: string };
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForSettled(page);
}

/** Wait for two animation frames so rAF-coalesced camera updates are on screen. */
export async function waitForSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export const zoomPercentLabel = (page: Page) => page.getByTestId('zoom-percent');

/** The zoom shown in the control, e.g. 125 for "125%". */
export async function readZoomPercent(page: Page): Promise<number> {
  const text = (await zoomPercentLabel(page).innerText()).trim();
  const match = /(-?\d+(?:\.\d+)?)%/.exec(text);
  if (!match) throw new Error(`zoom label is not a percentage: ${text}`);
  return Number(match[1]);
}

/** Centre of the origin crosshair in viewport pixels. */
export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export interface GridGeometry {
  /** Dot spacing in screen pixels. */
  spacing: number;
  /** Dot x positions: offsetX + n * spacing. */
  offsetX: number;
  /** Dot y positions: offsetY + n * spacing. */
  offsetY: number;
}

/** Read the rendered dot grid geometry from the viewport's background. */
export async function gridGeometry(page: Page): Promise<GridGeometry> {
  const raw = await page.getByTestId('board-viewport').evaluate((element) => {
    const style = window.getComputedStyle(element as HTMLElement);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
  const numbers = (value: string): number[] => (value.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const [spacingX = 0] = numbers(raw.size);
  const [offsetX = 0, offsetY = 0] = numbers(raw.position);
  return { spacing: spacingX, offsetX, offsetY };
}

/** Screen position of the nearest dot to (x, y), derived from the rendered grid. */
export function nearestDot(geography: GridGeometry, x: number, y: number): { x: number; y: number } {
  const snap = (value: number, offset: number) => {
    if (geography.spacing <= 0) return value;
    const index = Math.round((value - offset) / geography.spacing);
    return offset + index * geography.spacing;
  };
  return { x: snap(x, geography.offsetX), y: snap(y, geography.offsetY) };
}

export const mod = (value: number, period: number): number =>
  period > 0 ? ((value % period) + period) % period : 0;

/** True when `actual` and `expected` agree modulo `period` within `tolerance`. */
export function congruentModulo(actual: number, expected: number, period: number, tolerance: number): boolean {
  const distance = mod(actual - expected, period);
  return distance <= tolerance || period - distance <= tolerance;
}

/** Jump the camera directly (test build only) instead of dragging a million pixels. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error(HOOK_SELECT_ERROR);
    hooks.setCamera(next);
  }, camera);
  await waitForSettled(page);
}

/** Read the live camera (test build only). */
export async function readCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error(HOOK_SELECT_ERROR);
  return camera;
}

/** Drag the board by (dx, dy) starting at (x, y). */
export async function dragBoard(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await waitForSettled(page);
}

/** Ctrl + wheel over the board (a trackpad pinch in Chromium). */
export async function ctrlWheel(page: Page, x: number, y: number, deltaY: number): Promise<void> {
  await page.keyboard.down('Control');
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await waitForSettled(page);
}

export interface PageZoomSignals {
  /** Pinch zoom of the visual viewport. */
  visualViewportScale: number;
  /** Changes when the browser zooms the page. */
  devicePixelRatio: number;
  /** Viewport width in CSS pixels: changes when the browser zooms the page. */
  innerWidth: number;
  /** CSS font size of the zoom control: page text must not change size. */
  controlFontSizePx: number;
}

export async function pageZoomSignals(page: Page): Promise<PageZoomSignals> {
  const controlFontSizePx = await page.getByTestId('zoom-percent').evaluate((element) => {
    const parsed = Number.parseFloat(window.getComputedStyle(element as HTMLElement).fontSize);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const rest = await page.evaluate(() => ({
    visualViewportScale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
  }));
  return { ...rest, controlFontSizePx };
}

/** Grid spacing expected at a given zoom, in screen pixels. */
export const expectedGridSpacing = (zoom: number): number => GRID_SPACING_WORLD * zoom;

/** Zoom level from a percentage label. */
export const zoomFromPercent = (percent: number): number => percent / PERCENT;

/* ------------------------------------------------------------------------- sticky notes */

/** A sticky note as the shared model holds it. */
export interface NoteModel {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** Read the notes from the shared model (test build only), in stacking order. */
export async function readNotes(page: Page): Promise<readonly NoteModel[]> {
  const notes = await page.evaluate(() => window.__vidi6?.getStickyNotes());
  if (!notes) throw new Error(HOOK_SELECT_ERROR);
  return notes as unknown as readonly NoteModel[];
}

export const noteLocator = (page: Page, id: string) =>
  page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);

/** Centre of a note in viewport pixels, read from the rendered element. */
export async function noteCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** World point under the centre of the viewport. */
export function worldToScreen(camera: Camera, world: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** Double-click an empty spot of the board: creates a note there and starts editing it. */
export async function doubleClickBoard(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.dblclick(x, y);
  await waitForSettled(page);
}

/** Press a note, move it by (dx, dy) screen pixels, release. */
export async function dragNoteById(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await waitForSettled(page);
}

/** Select a note with a single click. */
export async function selectNoteById(page: Page, id: string): Promise<void> {
  const at = await noteCentre(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await waitForSettled(page);
}

/** The topmost note at a screen point, or `null`. */
export async function topmostNoteId(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    (args: number[]) => {
      const [px, py] = args as [number, number];
      const element = document.elementFromPoint(px, py);
      const note = element?.closest('[data-testid="sticky-note"]');
      return note?.getAttribute('data-note-id') ?? null;
    },
    [x, y],
  );
}
