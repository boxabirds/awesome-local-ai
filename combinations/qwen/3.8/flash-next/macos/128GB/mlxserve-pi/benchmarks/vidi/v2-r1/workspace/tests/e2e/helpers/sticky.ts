import { expect, type Locator, type Page } from '@playwright/test';
import { settle } from './board';

export interface NoteInfo {
  /** The id the board gave the note, which is the same id on every other screen. */
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  color: string;
  selected: boolean;
  editing: boolean;
  text: string;
}

const notesRoot = (page: Page): Locator => page.locator('[data-testid="sticky-note"]');

export const noteCount = async (page: Page): Promise<number> =>
  notesRoot(page).count();

/** All notes' world geometry and state, in board order. */
export async function readNotes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'),
    );
    return nodes.map((el) => ({
      id: el.dataset.id ?? '',
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      z: Number(el.dataset.z),
      color: el.dataset.color ?? '',
      selected: el.dataset.selected === 'true',
      editing: !!el.querySelector('textarea'),
      text: el.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '',
    }));
  });
}

export async function noteAt(page: Page, index: number): Promise<NoteInfo> {
  const all = await readNotes(page);
  const note = all[index];
  if (!note) throw new Error(`no sticky note at index ${index}`);
  return note;
}

/** Centre of a note in screen coordinates (getBoundingClientRect centre). */
export async function noteCentre(
  page: Page,
  index: number,
): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate((i) => {
    const el = document.querySelectorAll('[data-testid="sticky-note"]')[i];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, index);
  if (!centre) throw new Error(`no sticky note at index ${index}`);
  return centre;
}

/** The id of the one note this screen has selected. */
export async function selectedNoteId(page: Page): Promise<string> {
  const ids = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="sticky-note"][data-selected="true"]',
      ),
    ).map((element) => element.dataset.id ?? ''),
  );
  if (ids.length !== 1) {
    throw new Error(`expected one selected note, found ${String(ids.length)}`);
  }
  const id = ids[0];
  if (id === undefined || id === '') throw new Error('the selected note has no id');
  return id;
}

/** Double-click empty board space to create a note there and open its editor. */
export async function createNote(
  page: Page,
  x: number,
  y: number,
  text?: string,
): Promise<string> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid="sticky-note"] textarea');
  if (text !== undefined) await page.keyboard.type(text);
  // A note created through the board is the one selected, so its id is on the board.
  return selectedNoteId(page);
}

/** Finish the open editor (Escape) so the note is selected with its toolbar. */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="note-toolbar"]').first()).toBeVisible();
}

/** Drag an existing note (selected or not) by (dx, dy) screen pixels. */
export async function dragNote(
  page: Page,
  index: number,
  dx: number,
  dy: number,
): Promise<void> {
  const centre = await noteCentre(page, index);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + dx / 2, centre.y + dy / 2, { steps: 5 });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 5 });
  await page.mouse.up();
}

export const deleteButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Delete note' });

export const swatch = (page: Page, colour: string): Locator =>
  page.getByRole('button', { name: `${colour} colour` });

export const editorText = (page: Page): Locator =>
  page.locator('[data-testid="sticky-note-text"]').last();

// --- several objects at once (story 7) ---------------------------------------
//
// Selection lives in the screen-space chrome since story 7: the count, the delete
// button and the resize handles are siblings of the board, not parts of a note. A
// test that wants to know what is selected asks the board (`data-selected`) or the
// bar (`selection-count`); a test that wants to act on the selection presses the
// board's own keys or drags one of its handles.

/** A screen point. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** How many objects this screen has selected. */
export async function selectedCount(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"][data-selected="true"]').count();
}

/** The ids this screen has selected, in board order. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="sticky-note"][data-selected="true"]',
      ),
    ).map((element) => element.dataset.id ?? ''),
  );
}

/** What the bar says the selection is ("2 selected"), or null when there is no bar. */
export async function selectionText(page: Page): Promise<string | null> {
  const bar = page.getByTestId('selection-count');
  if ((await bar.count()) === 0) return null;
  return (await bar.first().textContent()) ?? null;
}

export const deleteSelectionButton = (page: Page): Locator =>
  page.getByTestId('delete-selection');

/** The bar itself, which is where a single selected note's tools live too. */
export const selectionBar = (page: Page): Locator => page.getByTestId('selection-bar');

/** Ctrl/Cmd+A: select everything on the board. */
export async function selectAllOnBoard(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await settle(page);
}

/** Escape: let go of the selection. */
export async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
}

/**
 * Shift-drag a box across empty board space: a marquee. Shift is what tells the
 * board's surface "this is a box, not a pan", and it has to be down before the
 * press for the board to read it that way.
 */
export async function marquee(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** A marquee that is let go of in the middle: cancelled, and so selects nothing. */
export async function marqueeCancelled(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.keyboard.up('Shift');
  // A lost pointer — the browser's own pointercancel, which a touch that turns
  // into a scroll is what produces.
  await page.locator('[data-testid="board-viewport"]').dispatchEvent('pointercancel');
  await page.mouse.up();
  await settle(page);
}

/**
 * Drag one of the eight handles of the selection box by (dx, dy) screen pixels.
 * The handle is addressed by the name it announces, because that name is what the
 * story asks for and what a person reads off the box.
 */
export async function dragHandle(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const handle = page.getByLabel(`Resize ${name}`);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (box === null) throw new Error(`no resize handle "${name}" on screen`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

/** The gap between two notes' edges, in world units: what a resize has to scale. */
export function gapBetween(a: NoteInfo, b: NoteInfo): number {
  return Math.max(b.left - (a.left + a.width), a.left - (b.left + b.width));
}
