/**
 * Helpers for the story 2 e2e tests: sticky notes in a real browser.
 *
 * The camera is fixed from the outside with `window.__vidi6`, as in story 1; what
 * these helpers add is the note side of the page — reading the document through the
 * same hook, finding notes by the attributes they publish, and doing the two things
 * a sticky note is used for: being created and being dragged.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import type { StickySnapshot } from '../../../src/shared/board-model';
import type { CameraOnPage, Point } from './board';
import { board, screenToWorld, settled } from './board';

/**
 * The notes as the document holds them, in stacking order. Read from the page's own
 * Y.Doc, so an assertion here is about what was stored, not about what is painted.
 */
export async function stickies(page: Page): Promise<readonly StickySnapshot[]> {
  const notes = await page.evaluate(() => window.__vidi6?.getStickies());
  if (!notes) throw new Error('the page does not expose its document; run `npm run test:e2e`');
  return notes;
}

export async function noteCount(page: Page): Promise<number> {
  return (await stickies(page)).length;
}

/** Note elements in the order they were made. Stacking is `paintedIds`, not this. */
export function notes(page: Page): Locator {
  return page.getByTestId('sticky-note');
}

/**
 * The notes in the order they are painted, bottom first. Stacking is done by
 * `z-index` — so it is read from the style each note is painted with, with the
 * order in the document breaking a tie, which is exactly how the browser does it.
 */
export async function paintedIds(page: Page): Promise<string[]> {
  const listed = await notes(page).evaluateAll((elements) =>
    elements.map((element, index) => ({
      id: element.getAttribute('data-note-id') ?? '',
      z: Number.parseFloat(getComputedStyle(element).zIndex) || 0,
      index,
    })),
  );
  return listed
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((note) => note.id);
}

export function noteAt(page: Page, index = 0): Locator {
  return notes(page).nth(index);
}

export function editor(page: Page): Locator {
  return page.getByTestId('sticky-textarea');
}

export function counter(page: Page): Locator {
  return page.getByTestId('sticky-counter');
}

export function fade(page: Page, index = 0): Locator {
  return noteAt(page, index).getByTestId('sticky-fade');
}

export function stickyButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Sticky note', exact: true });
}

export function swatch(page: Page, color: string): Locator {
  return page.getByRole('button', { name: `${color.charAt(0).toUpperCase()}${color.slice(1)} colour` });
}

export function deleteButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Delete note' });
}

export function noteToolbar(page: Page): Locator {
  return page.getByTestId('note-toolbar');
}

/** The box an element paints, in screen coordinates; throws when it paints nothing. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no bounding box: it is not painted');
  return box;
}

/** The box a note paints, in screen coordinates. */
export async function noteBox(page: Page, index = 0): Promise<Box> {
  return boxOf(noteAt(page, index));
}

export async function actualCentre(box: Box): Promise<Point> {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The point of a note that a pointer grabs, in board units. */
export function grabbedPoint(camera: CameraOnPage, note: StickySnapshot, pointer: Point): Point {
  const world = screenToWorld(camera, pointer);
  return { x: world.x - note.x, y: world.y - note.y };
}

/** Double-click empty board space; the note is created and ready for typing. */
export async function doubleClickBoard(page: Page, at: Point): Promise<void> {
  await board(page).dblclick({ position: at });
}

/** Creates a note at a screen point and types into it, leaving it selected. */
export async function createNote(page: Page, at: Point, text = ''): Promise<string> {
  await startNote(page, at, text);
  await page.keyboard.press('Escape');
  return lastNoteId(page);
}

/** Creates a note at a screen point and leaves it open for typing. */
export async function startNote(page: Page, at: Point, text = ''): Promise<string> {
  await doubleClickBoard(page, at);
  await expect(editor(page)).toBeVisible();
  if (text !== '') await page.keyboard.type(text);
  return lastNoteId(page);
}

/** The id of the note that was made last. */
export function lastNoteId(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6?.getStickies().at(-1)?.id ?? '');
}

/** Opens an existing note for typing, by double-clicking it. */
export async function startEditingNote(page: Page, index = 0): Promise<void> {
  await noteAt(page, index).dblclick();
  await expect(editor(page)).toBeVisible();
}

/** Types into the note that is being edited by setting the box and reporting an input. */
export async function pasteIntoEditor(page: Page, text: string): Promise<void> {
  // What a paste does to the DOM in the end: the box holds the whole text and one
  // `input` event reports it. Doing it this way keeps a 1200 character paste in the
  // browser's clipboard and its permissions out of the test.
  await editor(page).evaluate((element, value) => {
    const box = element as HTMLTextAreaElement;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

/** A real pointer drag of a note: press, move in steps, release. */
export async function dragNote(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/** A whole note, as the page shows it: where it is and how it is painted. */
export interface NoteAppearance {
  left: number;
  top: number;
  width: number;
  height: number;
  backgroundColor: string;
  fontSize: number;
  selected: string | null;
  interaction: string | null;
  overflow: string | null;
}

export async function noteAppearance(page: Page, index = 0): Promise<NoteAppearance> {
  return noteAt(page, index).evaluate((element) => {
    const style = getComputedStyle(element);
    const html = element as HTMLElement;
    return {
      left: Number.parseFloat(style.left),
      top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      backgroundColor: style.backgroundColor,
      fontSize: Number.parseFloat(style.fontSize),
      selected: html.dataset.selected ?? null,
      interaction: html.dataset.interaction ?? null,
      overflow: html.dataset.overflow ?? null,
    };
  });
}

/**
 * How the text inside a note is laid out, in board units. The note is scaled by the
 * camera, so every number is divided by the painted-to-own ratio: at 200% zoom a
 * scrollHeight of 400 device pixels is 200 board units.
 */
export interface TextLayout {
  /** Board units of text the box would need (its scroll height). */
  content: number;
  /** Board units the box shows (its client height). */
  visible: number;
  /** How far the text reaches past the bottom of the box, in board units. */
  overflow: number;
}

export async function textLayout(page: Page, index = 0): Promise<TextLayout> {
  return noteAt(page, index)
    .getByTestId('sticky-text')
    .evaluate((element) => {
      const box = element as HTMLElement;
      const painted = box.getBoundingClientRect().height;
      const scale = painted > 0 ? painted / box.offsetHeight : 1;
      const content = box.scrollHeight / scale;
      const visible = box.clientHeight / scale;
      return { content, visible, overflow: content - visible };
    });
}
