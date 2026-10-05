import { expect, type Locator, type Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import type { Participant } from './participants';
import { boardOf } from './participants';
import { editor, noteById } from './sticky-notes';

/**
 * Story 7 e2e helpers: the selection as the user sees it (attributes, overlay,
 * bar) and the pointer gestures that produce it.
 */

/** Notes the board says are selected. */
export function selectedNotes(page: Page): Locator {
  return page.locator('[data-sticky-note][data-selected="true"]');
}

export function selectionBar(page: Page): Locator {
  return page.locator('[data-selection-bar]');
}

export function selectionCount(page: Page): Locator {
  return page.locator('[data-selection-count]');
}

export function selectionLive(page: Page): Locator {
  return page.locator('[data-selection-live]');
}

export function marqueeRect(page: Page): Locator {
  return page.locator('[data-marquee]');
}

export function resizeHandles(page: Page): Locator {
  return page.locator('[data-resize-handle]');
}

export function resizeHandle(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label });
}

/** Ids of the selected notes, sorted so the order of clicking does not matter. */
export async function selectedIds(page: Page): Promise<string[]> {
  const ids = await page.$$eval(
    '[data-sticky-note][data-selected="true"]',
    (elements) => elements.map((element) => (element as HTMLElement).dataset.noteId ?? ''),
  );
  return ids.sort();
}

/** Press, drag and release with the Shift key held (the marquee). */
export async function shiftDragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  options: { steps?: number; whileDragging?: () => Promise<void> } = {},
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.whileDragging) await options.whileDragging();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: options.steps ?? 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Click a note, then Shift+click the rest: exactly this set is selected. */
export async function selectNotes(page: Page, ids: readonly string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    const box = await noteById(page, id).boundingBox();
    if (!box) throw new Error(`note ${id} has no bounding box`);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (index === 0) {
      await page.mouse.click(centre.x, centre.y);
    } else {
      // This Playwright version has no modifier option on `mouse.click`, so the
      // key is held down around it, which is what a hand does.
      await page.keyboard.down('Shift');
      await page.mouse.click(centre.x, centre.y);
      await page.keyboard.up('Shift');
    }
  }
  await expect.poll(() => selectedIds(page), { timeout: 5_000 }).toEqual([...ids].sort());
}

/** Leave text editing (if in it) and drop the selection, without a stray click. */
export async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(selectedNotes(page)).toHaveCount(0);
}

/** Where every note of the board is, by id. */
export async function positionsOf(
  participant: Participant,
): Promise<Map<string, { x: number; y: number; width: number; height: number; z: number }>> {
  const board = await boardOf(participant);
  return new Map(
    // A note with no stored size renders at the default (story 2).
    board.map((note: StickySnapshot) => [
      note.id,
      {
        x: note.x,
        y: note.y,
        width: note.width ?? STICKY_SIZE_WORLD,
        height: note.height ?? STICKY_SIZE_WORLD,
        z: note.z,
      },
    ]),
  );
}

/**
 * Create a note by double-clicking empty board space at a screen point, type its
 * text and leave editing, then wait until it is in the model.
 */
export async function createNoteAtScreen(
  participant: Participant,
  x: number,
  y: number,
  text: string,
): Promise<StickySnapshot> {
  await participant.page.mouse.dblclick(x, y);
  await editor(participant.page).waitFor({ state: 'visible' });
  await editor(participant.page).focus();
  await participant.page.keyboard.type(text, { delay: 10 });
  await participant.page.keyboard.press('Escape');
  await editor(participant.page).waitFor({ state: 'hidden' });
  await expect
    .poll(async () => (await boardOf(participant)).some((note) => note.text === text), {
      timeout: 10_000,
    })
    .toBe(true);
  const created = (await boardOf(participant)).find((note) => note.text === text)!;
  return created;
}
