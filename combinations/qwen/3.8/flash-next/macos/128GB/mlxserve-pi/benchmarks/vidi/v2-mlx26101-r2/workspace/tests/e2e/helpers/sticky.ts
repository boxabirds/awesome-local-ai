import { expect, type Locator, type Page } from '@playwright/test';

import type { Point } from '../../../src/client/canvas/camera.js';
import type { StickySnapshot } from '../../../src/shared/board-model.js';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config.js';
import { CENTRE, waitForRender } from './board.js';

/**
 * Sticky note helpers. The notes are read back from the board document through
 * the test-only hook (`window.__vidi6Board`, present in the test build), so a
 * test asserts the model as well as the pixels - and the two are checked
 * against each other.
 */

export const notes = (page: Page): Locator => page.getByTestId('sticky-note');

export const noteAt = (page: Page, index: number): Locator => notes(page).nth(index);

export const stickyEditor = (page: Page): Locator => page.getByTestId('sticky-editor');

export const stickyToolbarButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Sticky note' });

export const noteToolbar = (page: Page): Locator => page.getByTestId('note-toolbar');

export const colorSwatch = (page: Page, color: string): Locator =>
  page.getByTestId(`sticky-color-${color}`);

export const binButton = (page: Page): Locator => page.getByTestId('delete-note');

export const counter = (page: Page): Locator => page.getByTestId('sticky-counter');

/** The notes as the document holds them, in drawing order. */
export async function docNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => {
    const hooks = window.__vidi6Board;
    if (!hooks) {
      throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    }
    return [...hooks.getNotes()];
  });
}

export async function noteCount(page: Page): Promise<number> {
  return (await docNotes(page)).length;
}

export async function noteData(page: Page, index: number): Promise<StickySnapshot> {
  const notes = await docNotes(page);
  const note = notes[index];
  if (!note) throw new Error(`no note at position ${index} of ${notes.length}`);
  return note;
}

/**
 * A note looked up by its id, in whatever drawing position it currently holds.
 * Tests that change the stacking order must read notes by id: position in the
 * list is the thing they are asserting on.
 */
export async function noteById(page: Page, id: string): Promise<StickySnapshot> {
  const note = (await docNotes(page)).find((candidate) => candidate.id === id);
  if (!note) throw new Error(`no note with id ${id} on the board`);
  return note;
}

export async function noteText(page: Page, index: number): Promise<string> {
  return (await noteData(page, index)).text;
}

/** Where a note is drawn on screen, in CSS pixels. */
export async function noteBox(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await noteAt(page, index).boundingBox();
  if (!box) throw new Error(`note ${index} has no box: it is not drawn`);
  return box;
}

export async function noteCentre(page: Page, index: number): Promise<Point> {
  const box = await noteBox(page, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Poll until the document holds `count` notes and they are drawn. */
/**
 * The board this page is on, as the room addresses it.
 *
 * From the page rather than from the test: a test that starts its own server has to ask
 * the room by id, and reading the id off the URL would be reading it off the address the
 * test wrote, which is not evidence that this page is on that board.
 */
export async function boardIdOf(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.__vidi6Board?.getBoardId());
  if (id === undefined) throw new Error('this page is not on a board');
  return id;
}

export async function waitForNoteCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await docNotes(page)).length, { message: `expected ${count} notes` })
    .toBe(count);
  await expect(notes(page)).toHaveCount(count);
}

/** Create a note with the toolbar button (the note opens for typing). */
export async function createNote(page: Page): Promise<void> {
  await stickyToolbarButton(page).click();
  await waitForRender(page);
  await expect(stickyEditor(page)).toBeFocused();
}

/** Create a note by double-clicking a point of the empty board. */
export async function doubleClickBoard(page: Page, point: Point): Promise<void> {
  await page.mouse.dblclick(point.x, point.y);
  await expect(stickyEditor(page)).toBeFocused();
}

/** Leave editing through the keyboard, which keeps the note selected. */
export async function escapeEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(stickyEditor(page)).toHaveCount(0);
}

/** Type into the note that is open for editing. */
export async function typeIntoNote(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await expect
    .poll(async () => (await docNotes(page))[0]?.text ?? null, { message: 'text did not reach the document' })
    .toBe(text);
}

/** The editor that is open on the page, whichever note it belongs to. */
export function openEditor(page: Page): Locator {
  return page.locator('[data-testid="sticky-editor"]');
}

/** Which note the open editor belongs to, by its own element. */
export async function editingNoteIdOf(page: Page): Promise<string | null> {
  const editor = openEditor(page);
  if ((await editor.count()) === 0) return null;
  return editor.evaluate((element) => {
    const note = element.closest('[data-note-id]');
    return note instanceof HTMLElement ? note.dataset.noteId ?? null : null;
  });
}

/**
 * Type into the note that is open for editing, wherever it happens to sit in the
 * document. `typeIntoNote` asserts on the first note; once several people create
 * notes at the same time the one you just made is not necessarily first, so a
 * test that means "the note I am typing in" uses this instead.
 */
export async function typeIntoOpenEditor(page: Page, text: string): Promise<void> {
  await expect(openEditor(page)).toBeVisible();
  const id = await editingNoteIdOf(page);
  if (!id) throw new Error('no sticky note is open for editing');
  await page.keyboard.type(text);
  await expect
    .poll(async () => (await noteById(page, id)).text, {
      message: 'the typed text never reached the document',
    })
    .toBe(text);
}

/**
 * Put a long text into the note in one go, the way pasting does it: the browser
 * writes the whole value and reports a single `input` event.
 */
export async function pasteIntoNote(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const element = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"]');
    if (!element) throw new Error('no note is open for typing');
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await expect
    .poll(() => noteText(page, 0), { message: 'pasted text did not reach the document' })
    .toBe(text.length > 1000 ? text.slice(0, 1000) : text);
}

/**
 * Drag a note with a real mouse from `from` to `to` (both screen points). The
 * intermediate moves are stepped, so the note is measured mid-drag too.
 */
export async function dragNote(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await waitForRender(page);
}

/**
 * Which note is on top at a screen point: the note the browser would give the
 * next click to. Answering through the element under the point is what proves
 * the stacking order, rather than only the `z` number in the document.
 */
export async function topNoteId(page: Page, point: Point): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      const note = element?.closest<HTMLElement>('[data-note-id]');
      return note?.dataset.noteId ?? null;
    },
    { x: point.x, y: point.y },
  );
}

/** Computed font size of the note's text (or of its editor), in CSS pixels. */
export async function noteFontSize(page: Page, index: number): Promise<number> {
  const size = await page.evaluate((noteIndex) => {
    const note = document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')[noteIndex];
    if (!note) throw new Error(`note ${noteIndex} is not drawn`);
    const text =
      note.querySelector<HTMLElement>('[data-testid="sticky-editor"]') ??
      note.querySelector<HTMLElement>('[data-testid="sticky-text"]');
    if (!text) throw new Error(`note ${noteIndex} draws no text`);
    return Number.parseFloat(window.getComputedStyle(text).fontSize);
  }, index);
  if (!Number.isFinite(size)) throw new Error(`unreadable font size for note ${index}: ${size}`);
  return size;
}

/** True when the note's text is clipped (its scroll height exceeds its box). */
export async function noteTextOverflows(page: Page, index: number): Promise<boolean> {
  return page.evaluate((noteIndex) => {
    const note = document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')[noteIndex];
    const text =
      note?.querySelector<HTMLElement>('[data-testid="sticky-editor"]') ??
      note?.querySelector<HTMLElement>('[data-testid="sticky-text"]');
    if (!note || !text) throw new Error(`note ${noteIndex} is not drawn`);
    return text.scrollHeight > text.clientHeight + 1;
  }, index);
}

/** The note's width on screen: 200 world units at the current zoom. */
export async function noteScreenWidth(page: Page, index = 0): Promise<number> {
  const box = await noteBox(page, index);
  return box.width;
}

/** The world size the note's screen width stands for at the current zoom. */
export const STICKY_WIDTH_WORLD = STICKY_SIZE_WORLD;

/** Where the middle of the board (world 0,0) is on screen at the standard view. */
export const BOARD_CENTRE = CENTRE;
