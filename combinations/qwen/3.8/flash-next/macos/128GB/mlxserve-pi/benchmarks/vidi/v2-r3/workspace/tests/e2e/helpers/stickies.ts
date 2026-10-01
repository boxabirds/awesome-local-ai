import { expect, type Page } from '@playwright/test';
import { STICKY_COLOR_LABELS, STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/**
 * Sticky note helpers. Notes are found by their document id, because the
 * order of the notes in the DOM is their stacking order and changes as soon
 * as a note is brought to the front.
 */

export const noteLocator = (page: Page, id: string) => page.locator(`[data-note-id="${id}"]`);

export const editor = (page: Page) => page.locator('textarea');

export const counter = (page: Page) => page.locator('[data-testid="sticky-counter"]');

export const stickyButton = (page: Page) => page.getByRole('button', { name: 'Sticky note', exact: true });

export const noteToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Sticky note toolbar' });

export const deleteButton = (page: Page) => page.getByRole('button', { name: 'Delete note' });

export function swatch(page: Page, color: StickyColor) {
  const label = STICKY_COLOR_LABELS[color];
  return page.locator(`[aria-label="${label} colour"]`);
}

/** Ids of the rendered notes, in stacking order (bottom first). */
export function noteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-note-id]', (els) => els.map((el) => el.getAttribute('data-note-id')!));
}

export async function waitForNoteCount(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(async () => (await noteIds(page)).length, { timeout: 3000 })
    .toBe(count);
  return noteIds(page);
}

/** Id of the only note on the board (fails if there is not exactly one). */
export async function onlyNoteId(page: Page): Promise<string> {
  const ids = await waitForNoteCount(page, 1);
  return ids[0]!;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function noteBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await noteLocator(page, id).boundingBox();
  if (box === null) throw new Error(`note ${id} is not rendered`);
  return box;
}

export async function noteCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await noteBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The note's position in world (board) units, as stored in the document. */
export function noteWorldPos(page: Page, id: string): Promise<ScreenPoint> {
  return page.$eval(`[data-note-id="${id}"]`, (el) => {
    const s = (el as HTMLElement).style;
    return { x: parseFloat(s.left), y: parseFloat(s.top) };
  });
}

export function noteText(page: Page, id: string): Promise<string> {
  return page.$eval(`[data-note-id="${id}"] .sticky-text`, (el) => el.textContent ?? '');
}

/** Note and text colours as the browser paints them. */
export function noteColor(page: Page, id: string): Promise<string> {
  return page.$eval(`[data-note-id="${id}"]`, (el) => getComputedStyle(el).backgroundColor);
}

export function noteFontPx(page: Page, id: string): Promise<number> {
  return page.$eval(`[data-note-id="${id}"] .sticky-text`, (el) => parseFloat(getComputedStyle(el).fontSize));
}

/** '#FFF59D' -> 'rgb(255, 245, 157)', the form getComputedStyle reports. */
export function rgb(color: StickyColor): string {
  const hex = STICKY_COLORS[color].replace('#', '');
  const parts = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((pair) => parseInt(pair, 16));
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}

/** Is the note's text box clipped (faded) right now? */
export function noteHasFade(page: Page, id: string): Promise<boolean> {
  return page.$eval(`[data-note-id="${id}"] .sticky-text`, (el) => el.classList.contains('has-fade'));
}

/** The note's own box, and whether anything of it sticks outside the note. */
export function textBoxInside(page: Page, id: string): Promise<{ inside: boolean; clipped: boolean }> {
  return page.$eval(`[data-note-id="${id}"]`, (note, textSelector) => {
    const outer = (note as HTMLElement).getBoundingClientRect();
    const text = note.querySelector(textSelector) as HTMLElement;
    const inner = text.getBoundingClientRect();
    return {
      inside:
        inner.left >= outer.left - 0.5 &&
        inner.right <= outer.right + 0.5 &&
        inner.top >= outer.top - 0.5 &&
        inner.bottom <= outer.bottom + 0.5,
      // The text is longer than the box, so it is clipped rather than spilled.
      clipped: text.scrollHeight > text.clientHeight + 0.5 && getComputedStyle(text).overflow === 'hidden',
    };
  }, '.sticky-text');
}

/** Which note is drawn at this screen point (stacking, as painted). */
export function topNoteIdAt(page: Page, point: ScreenPoint): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const note = el ? el.closest('[data-note-id]') : null;
    return note ? note.getAttribute('data-note-id') : null;
  }, point);
}

/**
 * Drag a note by (dx, dy) screen pixels. The pointer is grabbed a little above
 * and left of the note's centre, so it stays inside the note even at 50 % zoom
 * where the note is half as wide on screen.
 */
export async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<ScreenPoint> {
  const box = await noteBox(page, id);
  const start = { x: box.x + box.width / 2 - 10, y: box.y + box.height / 2 - 10 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  return start;
}

/** Select a note with a click on its centre. */
export async function clickNote(page: Page, id: string): Promise<void> {
  const centre = await noteCentre(page, id);
  await page.mouse.click(centre.x, centre.y);
}

/** Poll until a note's centre sits within 1 px of a screen point. */
export async function expectCentreAt(page: Page, id: string, target: ScreenPoint): Promise<void> {
  await expect
    .poll(async () => {
      const c = await noteCentre(page, id);
      return Math.max(Math.abs(c.x - target.x), Math.abs(c.y - target.y));
    }, { timeout: 3000 })
    .toBeLessThanOrEqual(1);
}

/** Poll until a note has moved by exactly (dx, dy) screen pixels. */
export async function expectMovedBy(page: Page, id: string, before: ScreenPoint, dx: number, dy: number): Promise<void> {
  await expect
    .poll(async () => {
      const c = await noteCentre(page, id);
      return Math.max(Math.abs(c.x - before.x - dx), Math.abs(c.y - before.y - dy));
    }, { timeout: 3000 })
    .toBeLessThanOrEqual(1);
}

/** Poll until the note sits at a world position (within 1 board unit). */
export async function expectWorldAt(page: Page, id: string, x: number, y: number): Promise<void> {
  await expect
    .poll(async () => {
      const p = await noteWorldPos(page, id);
      return Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    }, { timeout: 3000 })
    .toBeLessThanOrEqual(1);
}

/** The camera the app holds, for asserting the board did not move. */
export function cameraOf(page: Page) {
  return page.evaluate(() => {
    const c = window.__vidi6?.getCamera();
    if (c === undefined) throw new Error('window.__vidi6 missing: run against `vite build --mode test`');
    return { x: c.x, y: c.y, zoom: c.zoom };
  });
}

/**
 * Double-click empty board space, type some text and finish editing, so a test
 * has a note with known content centred on that point. Returns the id of the
 * note that appeared, which is the new one whatever is already on the board.
 */
export async function createNoteAt(page: Page, point: ScreenPoint, text: string): Promise<string> {
  const before = await noteIds(page);
  await page.mouse.dblclick(point.x, point.y);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type(text);
  const after = await waitForNoteCount(page, before.length + 1);
  const id = after.find((candidate) => !before.includes(candidate))!;
  await page.keyboard.press('Escape');
  return id;
}

/** Is the note the selected one, as the app reports it? */
export function noteSelected(page: Page, id: string): Promise<boolean> {
  return page.$eval(`[data-note-id="${id}"]`, (el) => el.getAttribute('data-selected') === 'true');
}

/** The note's interaction state: unselected, pressed, selected, dragging, editing. */
export function noteState(page: Page, id: string): Promise<string> {
  return page.$eval(`[data-note-id="${id}"]`, (el) => el.getAttribute('data-state') ?? '');
}
