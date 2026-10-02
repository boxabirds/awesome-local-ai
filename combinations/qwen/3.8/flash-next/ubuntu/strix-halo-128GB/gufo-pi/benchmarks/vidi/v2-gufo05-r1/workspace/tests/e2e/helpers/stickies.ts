/**
 * Browser helpers for story 2: read the notes that are on screen, and drive the
 * pointer and keyboard the way a user does.
 *
 * The notes expose their document state as data attributes (`data-note-x/-y/-z`,
 * `data-color`, `data-text-length`, `data-selected`), so a test can compare what
 * the document says with what the browser has painted — the same trick the
 * camera attributes from story 1 use.
 */
import { expect, type Page } from '@playwright/test';

import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import { readCamera, setCamera, type ScreenPoint } from './board';

export const NOTE = '[data-testid="sticky-note"]';

export interface NoteOnScreen {
  id: string;
  /** Top-left in world coordinates. */
  x: number;
  y: number;
  z: number;
  color: string;
  textLength: number;
  selected: boolean;
  /** Painted rectangle in CSS pixels. */
  box: { x: number; y: number; width: number; height: number };
}

/** The notes in stacking order (the order the document renders them in). */
export async function readNotes(page: Page): Promise<NoteOnScreen[]> {
  return page.$$eval(NOTE, (elements) =>
    elements.map((element) => {
      const note = element as HTMLElement;
      const rect = note.getBoundingClientRect();
      return {
        id: note.dataset.noteId ?? '',
        x: Number(note.dataset.noteX),
        y: Number(note.dataset.noteY),
        z: Number(note.dataset.noteZ),
        color: note.dataset.color ?? '',
        textLength: Number(note.dataset.textLength),
        selected: note.dataset.selected === 'true',
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }),
  );
}

export async function noteCount(page: Page): Promise<number> {
  return (await page.$$(NOTE)).length;
}

/** Centre the view on a world point at a given zoom, without dragging. */
export async function centreView(page: Page, world: ScreenPoint, zoom: number): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await setCamera(page, {
    x: world.x - size.width / 2 / zoom,
    y: world.y - size.height / 2 / zoom,
    zoom,
  });
  await readCamera(page);
}

/** The world point in the middle of the screen right now. */
export function viewCentreWorld(page: Page, camera: { x: number; y: number; zoom: number }) {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  return {
    x: camera.x + size.width / 2 / camera.zoom,
    y: camera.y + size.height / 2 / camera.zoom,
  };
}

/** Double-click empty board space, which creates and starts editing a note. */
export async function doubleClickBoard(page: Page, point: ScreenPoint): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
}

/** Drag from a point that is on a note. */
export async function dragFrom(
  page: Page,
  from: ScreenPoint,
  delta: ScreenPoint,
  steps = 10,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100); // let the frame-coalesced writes settle
}

/** Type into the note that is being edited. */
export async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** Put text on the clipboard and paste it into the focused editor. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
  }, text);
  await page.keyboard.press('Control+V');
}

/** What the editor holds right now. */
export async function editorValue(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="sticky-note-textarea"]');
    return element instanceof HTMLTextAreaElement ? element.value : null;
  });
}

/** Computed font size of the text a note is showing, in CSS pixels. */
export async function noteFontSize(page: Page, index = 0): Promise<number> {
  const handles = await page.$$(NOTE);
  const element = handles[index];
  if (!element) throw new Error('there is no note to measure');
  const selector = `.sticky-note__text, .sticky-note__textarea`;
  const size = await element.evaluate((note, sel) => {
    const target = note.querySelector(sel);
    if (!target) throw new Error('the note renders no text');
    return Number.parseFloat(getComputedStyle(target).fontSize);
  }, selector);
  return size;
}

/** Whether the note's text is being clipped inside the note. */
export async function noteTextClip(page: Page, index = 0): Promise<{
  clipped: boolean;
  scrollHeight: number;
  clientHeight: number;
  hasFade: boolean;
}> {
  const handles = await page.$$(NOTE);
  const element = handles[index];
  if (!element) throw new Error('there is no note to measure');
  return element.evaluate((note) => {
    const target = note.querySelector<HTMLElement>('.sticky-note__text, .sticky-note__textarea');
    if (!target) throw new Error('the note renders no text');
    return {
      clipped: target.scrollHeight > target.clientHeight,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
      hasFade: Boolean(note.querySelector('.sticky-note__fade')),
    };
  });
}

/** Where a point inside a note lands: which note the browser paints on top. */
export async function noteIndexAtPoint(page: Page, point: ScreenPoint): Promise<number> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const note = element?.closest('[data-testid="sticky-note"]');
    if (!note) return -1;
    const all = Array.from(document.querySelectorAll('[data-testid="sticky-note"]'));
    return all.indexOf(note);
  }, point);
}

/** The note's centre in world coordinates. */
export function noteCentre(note: NoteOnScreen): ScreenPoint {
  return { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 };
}
