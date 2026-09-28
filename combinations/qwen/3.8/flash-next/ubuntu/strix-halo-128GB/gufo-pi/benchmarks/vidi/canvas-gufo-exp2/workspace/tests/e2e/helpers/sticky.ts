import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { cameraFromDom, originCentre, waitForRender } from './board';

/**
 * Sticky-note helpers for e2e. Notes are located by their model id wherever a
 * test needs to follow one specific note; `data-sticky-note` is the marker.
 */

export interface NoteModel {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

export async function noteModels(page: Page): Promise<NoteModel[]> {
  return page.evaluate(() => window.__vidi6?.getNotes?.() ?? []);
}

export async function deleteNoteViaModel(page: Page, id: string): Promise<boolean> {
  return page.evaluate((noteId) => window.__vidi6?.deleteNote?.(noteId) ?? false, id);
}

export function noteLocator(page: Page, id?: string) {
  return id
    ? page.locator(`[data-sticky-note][data-sticky-id="${id}"]`)
    : page.locator('[data-sticky-note]');
}

export async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-sticky-note]').count();
}

/** Centre of a note, in viewport coordinates. */
export async function noteCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a note by a screen offset, in the given steps, from its centre. */
export async function dragNoteBy(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await waitForRender(page);
}

/** Create a note by double-clicking a point of the board. */
export async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  const before = await noteModels(page);
  await page.mouse.dblclick(x, y);
  await waitForRender(page);
  const after = await noteModels(page);
  const created = after.find((note) => !before.some((n) => n.id === note.id));
  if (!created) throw new Error(`double-click at (${x}, ${y}) created no note`);
  return created.id;
}

/** Create a note with the toolbar button. */
export async function createNoteWithToolbar(page: Page): Promise<string> {
  const before = await noteModels(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await waitForRender(page);
  const after = await noteModels(page);
  const created = after.find((note) => !before.some((n) => n.id === note.id));
  if (!created) throw new Error('the Sticky note button created no note');
  return created.id;
}

/** Type into the single open editor. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('textarea[data-testid="sticky-textarea"]');
  await expect(editor).toHaveCount(1);
  await editor.pressSequentially(text);
}

/** The world position a screen point maps to (for clicking a known world spot). */
export async function screenAtWorld(page: Page, world: { x: number; y: number }) {
  const camera = await cameraFromDom(page);
  return {
    x: (world.x - camera.x) * camera.zoom,
    y: (world.y - camera.y) * camera.zoom,
  };
}

/** A point on the empty board, well away from the given world-space notes. */
export async function emptyBoardPoint(page: Page, avoid: { x: number; y: number }[] = []) {
  const centre = await originCentre(page);
  const camera = await cameraFromDom(page);
  const candidates = [
    { x: 200, y: 200 },
    { x: 1080, y: 200 },
    { x: 200, y: 640 },
    { x: 1080, y: 640 },
    { x: centre.x, y: 150 },
  ];
  for (const point of candidates) {
    const world = {
      x: point.x / camera.zoom + camera.x,
      y: point.y / camera.zoom + camera.y,
    };
    const clear = avoid.every((n) => Math.abs(n.x - world.x) > 130 || Math.abs(n.y - world.y) > 130);
    if (clear) return point;
  }
  return centre;
}

export async function openEditorCount(page: Page): Promise<number> {
  return page.locator('textarea[data-testid="sticky-textarea"]').count();
}

/** The fade overlay is present only when the text overflows. */
export async function fadeVisible(page: Page, id: string): Promise<boolean> {
  const fade = noteLocator(page, id).locator('[data-testid="sticky-note-fade"]');
  return (await fade.count()) === 1;
}

export async function editorCounterText(page: Page): Promise<string | null> {
  const counter = page.locator('[data-testid="sticky-counter"]');
  if ((await counter.count()) === 0) return null;
  return counter.textContent();
}

/** Double-click the centre of a note (to edit it). */
export async function doubleClickNote(page: Page, id: string): Promise<void> {
  const centre = await noteCentre(page, id);
  await page.mouse.dblclick(centre.x, centre.y);
  await waitForRender(page);
}
