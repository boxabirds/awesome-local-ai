// Story 7 e2e helpers (TC-32..TC-36).
//
// Notes are seeded through the TEST_HOOKS route (POST /__test/boards/:id/seed)
// which lays them out in a known grid: note i has its top-left at
// (40 + (i % 40) * 220, 40 + floor(i / 40) * 220), 200x200. Helpers are
// camera-aware: marquee corners and drag deltas are given in WORLD units and
// converted to screen with the parked camera, so a group can be zoomed to fit
// its (possibly off-screen) resize handles.

import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const VIEWPORT = '[data-testid="board-viewport"]';
export const SELECTION_BAR_COUNT = '.selection-bar__count';
export const SELECTION_BAR_DELETE = 'button[aria-label="Delete selection"]';

/** Top-left world coordinates of a seeded note i (matches the seed grid). */
export function seededNoteTopLeft(i: number): { x: number; y: number } {
  return { x: 40 + (i % 40) * 220, y: 40 + Math.floor(i / 40) * 220 };
}

/** Seed `count` stickies on the board (server side). */
export async function seedNotes(baseURL: string, boardId: string, count: number): Promise<void> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  const data = (await res.json()) as { ok: boolean; seeded: number };
  expect(data.ok, `seed ${count} notes should succeed`).toBe(true);
  expect(data.seeded).toBe(count);
}

/** Park the camera at a known value so world<->screen math is exact. */
export async function parkCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((cam) => {
    (window as any).__vidi6?.setCamera(cam);
  }, camera);
}

/** Wait until `count` sticky notes are rendered on the page. */
export async function expectNoteCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => page.locator('.sticky-note').count(), { timeout: 15_000 })
    .toBe(count);
}

/** The rendered world position/size of a note (left/top/width/height, world px). */
export async function noteWorld(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.locator(`.sticky-note[data-note-id="${id}"]`).evaluate((el) => {
    const s = el.style;
    return {
      x: parseFloat(s.left),
      y: parseFloat(s.top),
      w: parseFloat(s.width),
      h: parseFloat(s.height),
    };
  });
}

export function noteId(page: Page, nth: number): Promise<string | null> {
  return page.locator('.sticky-note').nth(nth).getAttribute('data-note-id');
}

/** Which notes are currently selected (by data-note-id). */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.locator('.sticky-note[data-selected]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-note-id') as string),
  );
}

/** Viewport-local screen point for a world point under `camera`. */
function localOf(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
}

/**
 * Shift+drag a marquee between two WORLD points. The press lands on empty
 * board space, which starts the marquee; the viewport captures the pointer so
 * the drag tracks over notes.
 */
export async function marqueeDrag(
  page: Page,
  camera: Camera,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  const vp = page.locator(VIEWPORT);
  const box = (await vp.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const s0 = localOf(camera, x0, y0);
  const s1 = localOf(camera, x1, y1);
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + s0.x, box.y + s0.y);
  await page.mouse.down();
  await page.mouse.move(box.x + s1.x, box.y + s1.y, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Press a selection's handle ("Resize <pos>") and drag it by a world delta. */
export async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
  zoom: number,
): Promise<void> {
  const handleEl = page.locator(`[aria-label="Resize ${handle}"]`);
  const box = (await handleEl.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx * zoom, cy + dy * zoom, { steps: 16 });
  await page.mouse.up();
}

/** Drag a note (by its id) by a world delta. Moves the whole selection. */
export async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  zoom: number,
): Promise<void> {
  const noteEl = page.locator(`.sticky-note[data-note-id="${id}"]`);
  const box = (await noteEl.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx * zoom, box.y + 20 + dy * zoom, { steps: 16 });
  await page.mouse.up();
}
