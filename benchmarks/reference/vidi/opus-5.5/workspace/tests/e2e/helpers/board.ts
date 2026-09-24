import { expect, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';

export interface Box { x: number; y: number }
export interface CameraState { x: number; y: number; zoom: number }

/** e2e pixel tolerance from the PRD (±1 px). */
export const PIXEL_TOLERANCE = 1;

/** See seed.ts: wrangler dev's proxy may drop an idle pooled POST; `initialize` is idempotent. */
const STALE_CONNECTION = 'Network connection lost';
const INITIALIZE_ATTEMPTS = 3;

/** Opens a new empty board, created through the TEST_HOOKS-only route (story 5). */
export async function openBoard(page: Page): Promise<void> {
  const boardId = newBoardId();
  for (let attempt = 1; ; attempt += 1) {
    const res = await page.request.post(`/__test/boards/${boardId}/initialize`);
    if (res.ok()) break;
    const body = await res.text();
    if (attempt < INITIALIZE_ATTEMPTS && body.includes(STALE_CONNECTION)) continue;
    expect(res.ok(), body.slice(0, 500)).toBe(true);
  }
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(zoomLabel(page)).toHaveText('100%');
}

export function zoomLabel(page: Page) {
  return page.getByRole('status', { name: 'Zoom level' });
}

/** Screen centre of the origin crosshair (world 0,0). */
export async function originMarkerCentre(page: Page): Promise<Box> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function viewportCentre(page: Page): Promise<Box> {
  const box = await page.getByTestId('board-viewport').boundingBox();
  if (!box) throw new Error('board not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The dot grid is a CSS background: dots sit at the centre of each tile, so the
 * screen position of one dot is background-position + spacing/2.
 */
export async function gridState(page: Page): Promise<{ spacing: number; dotX: number; dotY: number }> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const style = getComputedStyle(el);
    const spacing = parseFloat(style.backgroundSize.split(' ')[0] ?? '');
    const [px, py] = style.backgroundPosition.split(' ').map((v) => parseFloat(v));
    return { spacing, dotX: (px ?? NaN) + spacing / 2, dotY: (py ?? NaN) + spacing / 2 };
  });
}

/** Distance from `value` to the nearest multiple of `modulus` (for periodic grid checks). */
export function periodicDistance(value: number, modulus: number): number {
  const r = ((value % modulus) + modulus) % modulus;
  return Math.min(r, modulus - r);
}

export async function setCamera(page: Page, camera: CameraState): Promise<void> {
  await page.evaluate((c) => {
    if (!window.__vidi6) throw new Error('test hook missing: run against the test-mode build');
    window.__vidi6.setCamera(c);
  }, camera);
}

export async function getCamera(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    if (!window.__vidi6) throw new Error('test hook missing');
    return window.__vidi6.getCamera();
  });
}

export async function pageZoomState(page: Page): Promise<{ scale: number; dpr: number; width: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
    width: window.innerWidth,
  }));
}

/** Waits for the next two animation frames so batched camera updates are rendered. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function drag(page: Page, from: Box, dx: number, dy: number): Promise<void> {
  const STEPS = 10;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: STEPS });
  await page.mouse.up();
  await nextFrames(page);
}

export interface NoteState {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  /** Present once written (story 7): new notes and resized notes. */
  width?: number;
  height?: number;
}

/** Notes as stored in the board document, sorted bottom to top. */
export async function getNotes(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    if (!window.__vidi6) throw new Error('test hook missing');
    return window.__vidi6.getNotes().map((n) => ({ ...n }));
  });
}

export function noteLocator(page: Page, id?: string) {
  return id === undefined
    ? page.getByRole('group', { name: 'Sticky note' })
    : page.locator(`[role="group"][aria-label="Sticky note"][data-id="${id}"]`);
}

export async function boxOf(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} not rendered`);
  return box;
}
