import { expect, type Page } from '@playwright/test';

import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import { PIXEL_TOLERANCE, readCamera, settle, worldToScreen, type Point } from './board';

/** What a note on the screen says about itself. */
export interface NoteState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly overflow: boolean;
  readonly text: string;
}

export const notes = (page: Page) => page.getByTestId('sticky-note');

/** Notes in the order they are painted: bottom to top. */
export async function readNotes(page: Page): Promise<NoteState[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')).map(
      (el) => ({
        id: el.dataset.noteId ?? '',
        x: Number(el.dataset.x),
        y: Number(el.dataset.y),
        z: Number(el.dataset.z),
        color: el.dataset.color ?? '',
        selected: el.dataset.selected === 'true',
        dragging: el.dataset.dragging === 'true',
        overflow: el.dataset.overflow === 'true',
        // While the note is open for typing its text is in the textarea, which
        // holds exactly what the document holds: every keystroke is written.
        text:
          el.querySelector('textarea')?.value ??
          el.querySelector('[data-testid="sticky-text"]')?.textContent ??
          '',
      }),
    ),
  );
}

export async function noteIds(page: Page): Promise<string[]> {
  return (await readNotes(page)).map((note) => note.id);
}

export async function readNote(page: Page, index = 0): Promise<NoteState> {
  const all = await readNotes(page);
  if (all.length <= index) throw new Error(`expected a note at position ${index}`);
  return all[index];
}

/** The note with this id; throws when it is not on the board. */
export async function noteById(page: Page, id: string): Promise<NoteState> {
  const note = (await readNotes(page)).find((candidate) => candidate.id === id);
  if (!note) throw new Error(`no note ${id} on the board`);
  return note;
}

/** The element that holds the note's text: the display box or the textarea. */
export const textBox = (page: Page, index = 0) =>
  notes(page).nth(index).locator('[data-sticky-text-box="true"]');

export const stickyTool = (page: Page) => page.getByRole('button', { name: /^Sticky note$/ });
export const swatch = (page: Page, colour: string) =>
  page.getByRole('button', { name: new RegExp(`^${colour} colour$`) });
export const binButton = (page: Page) => page.getByRole('button', { name: 'Delete note' });
export const fade = (page: Page, index = 0) =>
  notes(page).nth(index).getByTestId('sticky-fade');
export const counter = (page: Page, index = 0) =>
  notes(page).nth(index).getByTestId('sticky-counter');
export const editor = (page: Page, index = 0) =>
  notes(page).nth(index).getByTestId('sticky-textarea');

/**
 * The editor of one particular note. On a board with several notes, "the note
 * that is open for typing" is not the same thing as "the first note on the
 * screen", and a test that confuses them waits for the wrong element.
 */
export const noteEditor = (page: Page, id: string) =>
  page.locator(
    `[data-testid="sticky-note"][data-note-id="${id}"] [data-testid="sticky-textarea"]`,
  );

/** Double-click empty board space; the note appears there and is ready to type in. */
export async function createNote(page: Page, at: Point): Promise<NoteState> {
  const before = await noteIds(page);
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
  await expect(async () => {
    const after = await readNotes(page);
    expect(after.length).toBe(before.length + 1);
  }).toPass();
  // The new note is the last one painted: it is put on top when created.
  const all = await readNotes(page);
  return all[all.length - 1];
}

/** Type into the note that is open for editing. */
export async function typeIntoNote(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await settle(page);
}

/** Drag from a point on the note by a screen delta. */
export async function dragNote(
  page: Page,
  from: Point,
  delta: Point,
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await settle(page);
}

/** Where a note's centre is painted on the screen. */
export async function noteCentreOnScreen(page: Page, note: NoteState): Promise<Point> {
  const camera = await readCamera(page);
  return worldToScreen(camera, {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  });
}

export async function expectNoteCentre(
  page: Page,
  note: NoteState,
  expected: Point,
  tolerance = PIXEL_TOLERANCE,
) {
  await expect
    .poll(async () => {
      const centre = await noteCentreOnScreen(page, note);
      return Math.max(Math.abs(centre.x - expected.x), Math.abs(centre.y - expected.y));
    })
    .toBeLessThanOrEqual(tolerance);
}

/**
 * The note painted nearest to this screen point, or `null` for board space. This
 * is what a user would hit, so it is the stacking order itself.
 */
export async function noteAtPoint(page: Page, point: Point): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    const note = target ? target.closest('[data-testid="sticky-note"]') : null;
    return note ? note.getAttribute('data-note-id') : null;
  }, point);
}

export async function expectNoteAtPoint(page: Page, point: Point, id: string | null) {
  await expect
    .poll(async () => noteAtPoint(page, point))
    .toBe(id);
}

/** Computed font size of the note's text, in screen pixels. */
export async function textBoxFontSize(page: Page, index = 0): Promise<number> {
  const px = await textBox(page, index).evaluate((el) => getComputedStyle(el).fontSize);
  return Number.parseFloat(px);
}

/**
 * The fitted font size once the note has finished fitting the text to its box:
 * the size stops changing.
 */
export async function fittedFontSize(page: Page, index = 0): Promise<number> {
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await textBoxFontSize(page, index);
      const settled = now === previous;
      previous = now;
      return settled;
    })
    .toBe(true);
  return previous;
}

/** The box the text is drawn in and the box of the note, in screen pixels. */
export async function textBoxMetrics(page: Page, index = 0) {
  return {
    box: await textBox(page, index).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflow: style.overflow,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      };
    }),
    note: await notes(page)
      .nth(index)
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
  };
}
