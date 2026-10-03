import { expect, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../../src/shared/config';
import { readCamera, setCamera, settle, VIEWPORT, worldLayer, type ScreenPoint } from './board';

/** Pixel tolerance from the PRD ("within 1 pixel"). */
export const PX = 1;

export const notes = (page: Page): Locator => page.getByTestId('sticky-note');
export const noteAt = (page: Page, index = 0): Locator => notes(page).nth(index);

/**
 * Notes are drawn in stacking order, so a note that was brought to the front moves to the
 * end of the DOM. Anything that happens around a drag looks notes up by id.
 */
export const noteById = (page: Page, id: string): Locator =>
  page.locator(`[data-sticky-note][data-note-id="${id}"]`);

export const textOf = (note: Locator): Locator => note.getByTestId('sticky-note-text');
export const textAt = (page: Page, index = 0): Locator => textOf(noteAt(page, index));
export const textById = (page: Page, id: string): Locator => textOf(noteById(page, id));

export const fadeOf = (note: Locator): Locator => note.getByTestId('sticky-note-fade');
export const fadeAt = (page: Page, index = 0): Locator => fadeOf(noteAt(page, index));
export const clipOf = (note: Locator): Locator => note.locator('.sticky-note__clip');
export const clipAt = (page: Page, index = 0): Locator => clipOf(noteAt(page, index));
export const toolbarOf = (note: Locator): Locator => note.getByTestId('note-toolbar');
export const toolbarAt = (page: Page, index = 0): Locator => toolbarOf(noteAt(page, index));
export const toolbarById = (page: Page, id: string): Locator => toolbarOf(noteById(page, id));

export const editor = (page: Page): Locator => page.getByTestId('sticky-note-editor');
export const noteCounter = (page: Page): Locator => page.getByTestId('sticky-note-counter');
export const createStickyButton = (page: Page): Locator => page.getByTestId('create-sticky');

const LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export const colourSwatch = (page: Page, colour: StickyColor): Locator =>
  page.getByRole('button', { name: `${LABELS[colour]} colour` });
export const deleteNoteButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Delete note' });

export interface NoteState {
  x: number;
  y: number;
  z: number;
  color: string;
  selected: boolean;
}

async function stateOf(note: Locator): Promise<NoteState> {
  const read = await note.evaluate((element) => ({
    x: Number.parseFloat(element.getAttribute('data-x') ?? ''),
    y: Number.parseFloat(element.getAttribute('data-y') ?? ''),
    z: Number.parseFloat(element.getAttribute('data-z') ?? ''),
    color: element.getAttribute('data-color') ?? '',
    selected: element.getAttribute('data-selected') === 'true',
    styled: /left: -?[\d.]+px/.test(element.getAttribute('style') ?? ''),
  }));
  if (!read.styled || Number.isNaN(read.x) || Number.isNaN(read.y)) {
    throw new Error(`note is not positioned in world units: ${JSON.stringify(read)}`);
  }
  return { x: read.x, y: read.y, z: read.z, color: read.color, selected: read.selected };
}

export const noteState = (page: Page, index = 0): Promise<NoteState> => stateOf(noteAt(page, index));
export const stateById = (page: Page, id: string): Promise<NoteState> => stateOf(noteById(page, id));

/**
 * The parts of a note that dragging a different note must leave alone. Selection is not in
 * this list on purpose: grabbing one note lets go of whichever one was selected.
 */
export function unchanged(note: NoteState): {
  x: number;
  y: number;
  z: number;
  color: string;
} {
  return { x: note.x, y: note.y, z: note.z, color: note.color };
}

/** The id stored on a note element, for stacking questions. */
export async function noteId(page: Page, index = 0): Promise<string> {
  const id = await noteAt(page, index).getAttribute('data-note-id');
  if (id === null) {
    throw new Error(`note ${index} has no note id`);
  }
  return id;
}

/** The ids of the notes in the order they are drawn, bottom of the stack first. */
export async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-sticky-note]')].map(
      (element) => element.getAttribute('data-note-id') ?? '',
    ),
  );
}

/** Wait until the document, and so the DOM, holds `count` notes. */
export async function waitForNoteCount(page: Page, count: number): Promise<void> {
  await expect.poll(() => notes(page).count(), { timeout: 5_000 }).toBe(count);
}

export async function waitForNote(page: Page, index: number): Promise<NoteState> {
  await expect
    .poll(() => noteAt(page, index).count(), { timeout: 5_000 })
    .toBeGreaterThan(index);
  return noteState(page, index);
}

/** An element's box on screen, with a clear message when it is not laid out. */
export async function boxOf(element: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await element.boundingBox();
  if (box === null) {
    throw new Error('the element is not on screen');
  }
  return box;
}

async function centreOf(note: Locator): Promise<ScreenPoint> {
  const box = await boxOf(note);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of a note on screen, in viewport pixels. */
export const noteCentreOnScreen = (page: Page, index = 0): Promise<ScreenPoint> =>
  centreOf(noteAt(page, index));
export const centreByIdOnScreen = (page: Page, id: string): Promise<ScreenPoint> =>
  centreOf(noteById(page, id));

async function sizeOf(note: Locator): Promise<{ width: number; height: number }> {
  const box = await boxOf(note);
  return { width: box.width, height: box.height };
}

export const noteSizeOnScreen = (page: Page, index = 0): Promise<{ width: number; height: number }> =>
  sizeOf(noteAt(page, index));

/** The font size a note's text is drawn at, in the editor or in the note itself. */
export async function noteFontSize(note: Locator, page: Page): Promise<number> {
  const area = editor(page);
  if ((await area.count()) > 0) {
    return Number.parseFloat(await area.evaluate((node) => getComputedStyle(node).fontSize));
  }
  return Number.parseFloat(
    await textOf(note).evaluate((node) => getComputedStyle(node).fontSize),
  );
}

/** How much of a note's text is drawn outside the box that shows it. */
export async function textOverflow(note: Locator, page: Page): Promise<boolean> {
  const area = editor(page);
  const element = (await area.count()) > 0 ? area : clipOf(note);
  return element.evaluate((node) => node.scrollHeight > node.clientHeight);
}

/** The camera that puts a world point in the middle of the screen at a given zoom. */
export function cameraAround(world: ScreenPoint, zoom: number): Camera {
  return {
    x: world.x - VIEWPORT.width / 2 / zoom,
    y: world.y - VIEWPORT.height / 2 / zoom,
    zoom,
  };
}

/**
 * Move the view so that a whole note sits in the middle of the screen at `zoom`, and give
 * back the camera the board is now on.
 */
export async function centreNote(page: Page, index: number, zoom: number): Promise<Camera> {
  return centreNoteById(page, await noteId(page, index), zoom);
}

export async function centreNoteById(page: Page, id: string, zoom: number): Promise<Camera> {
  const note = await stateById(page, id);
  await setCamera(
    page,
    cameraAround({ x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 }, zoom),
  );
  return readCamera(page);
}

/** Double-click empty board space: the way a note is born. */
export async function doubleClickBoard(page: Page, at: ScreenPoint): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  await settle(page);
}

/** Press, move in steps, release: a drag with the real pointer. */
export async function dragPointer(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await settle(page);
}

/** Type into the note that is being edited, one keystroke at a time. */
export async function typeInNote(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await settle(page);
}

/** Replace the note's whole text, which is what a paste does. */
export async function pasteIntoNote(page: Page, text: string): Promise<void> {
  await editor(page).fill(text);
  await settle(page);
}

/** Stop editing with the keyboard; the note stays selected. */
export async function stopEditing(page: Page): Promise<void> {
  await editor(page).press('Escape');
  await settle(page);
}

/** The id of the note drawn on top at a screen point, or null if no note is there. */
export async function topNoteId(page: Page, at: ScreenPoint): Promise<string | null> {
  return page.evaluate((point) => {
    const element = document.elementFromPoint(point.x, point.y);
    const note = element instanceof Element ? element.closest('[data-sticky-note]') : null;
    return note === null ? null : (note.getAttribute('data-note-id') ?? '');
  }, at);
}

/** Click a colour swatch and wait for the note to take the colour. */
export async function setColour(page: Page, id: string, colour: StickyColor): Promise<void> {
  await colourSwatch(page, colour).click();
  await expect
    .poll(async () => (await stateById(page, id)).color, { timeout: 5_000 })
    .toBe(colour);
}

/** The note's background colour as the browser paints it, e.g. "rgb(244, 143, 177)". */
export async function noteBackground(note: Locator): Promise<string> {
  return note.evaluate((element) => getComputedStyle(element).backgroundColor);
}

/** Where the caret sits in the field that has focus, or -1. */
export async function caretAt(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLTextAreaElement | null;
    return element instanceof HTMLTextAreaElement ? element.selectionStart : -1;
  });
}

/** Where the world origin is drawn, so a test can say "we really are far away". */
export async function originOnScreen(page: Page): Promise<ScreenPoint> {
  const raw = await worldLayer(page).getAttribute('data-camera');
  if (raw === null) {
    throw new Error('world layer has no camera readout');
  }
  const [x, y, zoom] = raw.split(',').map(Number) as [number, number, number];
  return { x: (0 - x) * zoom, y: (0 - y) * zoom };
}
