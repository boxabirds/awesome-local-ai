import { expect, type Locator, type Page } from '@playwright/test';

import type { Point } from '../../../src/client/canvas/camera.js';
import type { Handle } from '../../../src/shared/geometry.js';
import { waitForRender } from './board.js';
import { doubleClickBoard, escapeEditing } from './sticky.js';

/**
 * Multi-selection helpers (story 7).
 *
 * Everything here drives the real page the way a person does - Shift+drag for a
 * marquee, Ctrl+A for select-all, the resize handles, the arrow keys - and reads
 * the outcome back from the DOM (a note carries `data-selected` when it is in the
 * local selection; the SelectionBar carries the count). Selection is per-client
 * and never written to the document, so it is asserted through the DOM, while
 * positions are asserted through the document (via the `sticky.ts` helpers).
 */

/** The note element with this id, wherever it is drawn. */
export const noteLocator = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);

/** The resize handle for one edge/corner of the current selection. */
export const handleLocator = (page: Page, handle: Handle): Locator =>
  page.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`);

export const selectionBar = (page: Page): Locator => page.getByTestId('selection-bar');

export const selectionCountText = (page: Page): Locator => page.getByTestId('selection-count');

/** The ids of the notes currently in this page's local selection, in drawing order. */
export function selectedNoteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="sticky-note"][data-selected="true"]', (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.noteId ?? ''),
  );
}

/** The SelectionBar's number, or null when the bar is not shown (fewer than two). */
export async function selectionCount(page: Page): Promise<number | null> {
  const bar = selectionCountText(page);
  if ((await bar.count()) === 0) return null;
  const text = (await bar.textContent()) ?? '';
  const match = /^(\d+) selected$/.exec(text.trim());
  return match ? Number(match[1]) : null;
}

/** Ctrl/Cmd+A - select every object on the board. */
export async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('Control+A');
  await waitForRender(page);
}

/** Escape - clear the selection (the board is focused, so this is not typing). */
export async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await waitForRender(page);
}

/**
 * A marquee: Shift+drag a rectangle across **empty** board space (the `from`
 * point must not be on a note, or it would toggle that note instead of starting a
 * marquee). A marquee only ever *adds* fully-contained objects to the selection.
 */
export async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await waitForRender(page);
}

/** Click a note (optionally Shift = toggle it in/out of the selection). */
export async function clickNote(page: Page, id: string, shift = false): Promise<void> {
  const locator = noteLocator(page, id);
  if (shift) await locator.click({ modifiers: ['Shift'] });
  else await locator.click();
  await waitForRender(page);
}

/** Press Delete with the board focused, removing the whole selection. */
export async function pressDelete(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
  await waitForRender(page);
}

/** Click the SelectionBar's "Delete selection" button. */
export async function clickDeleteSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await waitForRender(page);
}

/**
 * Drag a selected note from a screen point by `delta`. The note under `from` is
 * raised and, if the selection is larger, the whole selection moves with it.
 */
export async function dragBy(page: Page, from: Point, delta: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await waitForRender(page);
}

/** Start on a resize handle and drag it by `delta` (screen pixels). */
export async function dragHandle(page: Page, handle: Handle, delta: Point): Promise<void> {
  const box = await handleLocator(page, handle).boundingBox();
  if (!box) throw new Error(`resize handle ${handle} is not drawn`);
  await dragBy(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    delta,
  );
}

/** Press an arrow key `times` (Shift makes it a large nudge). */
export async function nudgeSelection(
  page: Page,
  direction: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  times = 1,
  shift = false,
): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(shift ? `Shift+${direction}` : direction);
  }
  await waitForRender(page);
}

/**
 * Seed one sticky note centred on each screen point, through the real create
 * gesture, and hand back the id of each in the same order. The notes are left
 * empty (no typing) and the board, not a note, ends up focused - ready for a
 * marquee, select-all or keyboard command.
 */
export async function seedStickyAt(page: Page, points: Point[]): Promise<string[]> {
  const ids: string[] = [];
  for (const point of points) {
    await doubleClickBoard(page, point);
    await escapeEditing(page);
    const selected = await selectedNoteIds(page);
    if (selected.length !== 1) {
      throw new Error(`expected the note just created to be solely selected, saw ${selected.length}`);
    }
    ids.push(selected[0]!);
  }
  await clearSelection(page);
  return ids;
}

/** The centre of a note on screen, in CSS pixels (for starting a drag on it). */
export async function screenCentre(page: Page, id: string): Promise<Point> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} is not drawn`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Poll until this page's selection holds exactly these ids (order-insensitive). */
export async function expectSelection(page: Page, ids: string[]): Promise<void> {
  const want = [...ids].sort().join(',');
  await expect
    .poll(async () => (await selectedNoteIds(page)).sort().join(','), {
      message: `selection never became {${want}}`,
      timeout: 5_000,
    })
    .toBe(want);
}
