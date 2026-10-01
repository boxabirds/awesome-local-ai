import { expect, test } from '@playwright/test';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  doubleClickBoard,
  dragNoteById,
  noteCentre,
  noteLocator,
  openBoard,
  readCamera,
  readNotes,
  selectNoteById,
  setCamera,
  topmostNoteId,
  waitForSettled,
  worldToScreen,
} from './helpers/board';
import { LONG_TEXT, OVERLONG_TEXT, RETRO_ITEM } from '../fixtures/texts';

const CENTRE = { x: 640, y: 400 };

/** Create one note by double-clicking empty board space; returns its id. */
async function createNote(page: import('@playwright/test').Page, at = CENTRE): Promise<string> {
  const before = await readNotes(page);
  await doubleClickBoard(page, at.x, at.y);
  await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
  const after = await readNotes(page);
  const created = after.find((note) => !before.some((entry) => entry.id === note.id));
  if (!created) throw new Error('double-click did not create a note');
  return created.id;
}

test.describe('workflow: capture and rearrange sticky notes', () => {
  test('TC-32 dragging a note over another raises it above the note it overlaps', async ({
    page,
  }) => {
    await openBoard(page);

    // 1280x800 viewport, notes are 200 px squares at zoom 1: the two notes overlap in a
    // 20 px band, and each centre is free of the other note.
    const bottom = await createNote(page, { x: 520, y: 400 });
    const top = await createNote(page, { x: 700, y: 400 });
    expect(await topmostNoteId(page, 610, 400)).toBe(top);

    // Drag the bottom note exactly onto the other one.
    await dragNoteById(page, bottom, 180, 0);

    const overlap = await noteCentre(page, top);
    expect(await topmostNoteId(page, overlap.x, overlap.y)).toBe(bottom);
    const notes = await readNotes(page);
    expect(notes[notes.length - 1]?.id).toBe(bottom);
    expect(notes[0]?.id).toBe(top);
  });

  test('TC-33 a note full of text fades at the bottom and keeps the whole text', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page);

    await page.keyboard.insertText(LONG_TEXT);
    await waitForSettled(page);

    const note = noteLocator(page, id);
    await expect(note.getByTestId('sticky-note-fade')).toBeVisible();
    await expect(note).toHaveAttribute('data-overflow', 'true');
    expect((await readNotes(page))[0]?.text).toBe(LONG_TEXT);

    // Ending the edit keeps showing the whole text, faded, never truncated.
    await page.keyboard.press('Escape');
    await expect(note.getByTestId('sticky-note-text')).toContainText(LONG_TEXT.slice(-24));
    await expect(note.getByTestId('sticky-note-fade')).toBeVisible();
  });

  test('TC-34 dragging at 200 % after panning far maps screen pixels to world units', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 4_000, y: -3_000, zoom: 2 });

    const id = await createNote(page);
    const before = (await readNotes(page)).find((note) => note.id === id);
    // The note was created under the pointer: world = camera + screen / zoom.
    expect(before?.x).toBeCloseTo(4_000 + CENTRE.x / 2 - STICKY_SIZE_WORLD / 2, 1);
    expect(before?.y).toBeCloseTo(-3_000 + CENTRE.y / 2 - STICKY_SIZE_WORLD / 2, 1);

    const cameraBefore = await readCamera(page);
    await dragNoteById(page, id, 150, -90);

    const after = (await readNotes(page)).find((note) => note.id === id);
    expect(after?.x).toBeCloseTo((before?.x ?? 0) + 150 / 2, 1);
    expect(after?.y).toBeCloseTo((before?.y ?? 0) - 90 / 2, 1);

    // The board itself did not move, and the note stayed under the pointer on screen.
    expect(await readCamera(page)).toEqual(cameraBefore);
    const screen = worldToScreen(cameraBefore, {
      x: (after?.x ?? 0) + STICKY_SIZE_WORLD / 2,
      y: (after?.y ?? 0) + STICKY_SIZE_WORLD / 2,
    });
    expect(Math.abs(screen.x - (CENTRE.x + 150))).toBeLessThanOrEqual(2);
    expect(Math.abs(screen.y - (CENTRE.y - 90))).toBeLessThanOrEqual(2);
  });

  test('TC-35 cycling the colour swatches recolours the note and keeps it selected', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page);
    await page.keyboard.press('Escape');

    const note = noteLocator(page, id);
    await expect(note).toHaveAttribute('data-color', DEFAULT_STICKY_COLOR);

    for (const name of ['pink', 'green', 'blue'] as const) {
      await page.getByTestId(`swatch-${name}`).click();
      await expect(note).toHaveAttribute('data-color', name);
      await expect(note).toHaveAttribute('data-selected', 'true');
      await expect(
        note.evaluate((element) => window.getComputedStyle(element as HTMLElement).backgroundColor),
      ).toBe(rgb(STICKY_COLORS[name]));
      // The toolbar stays open, so the next colour can be clicked right away.
      await expect(page.getByTestId('note-toolbar')).toBeVisible();
    }

    expect((await readNotes(page))[0]?.color).toBe('blue');
  });

  test('TC-36 the toolbar button creates a note at the centre of the viewport', async ({
    page,
  }) => {
    await openBoard(page);

    await page.getByTestId('create-sticky-button').click();
    await expect(page.getByTestId('sticky-note-editor')).toBeVisible();

    const notes = await readNotes(page);
    expect(notes).toHaveLength(1);
    const camera = await readCamera(page);
    const centre = worldToScreen(camera, {
      x: (notes[0]?.x ?? 0) + STICKY_SIZE_WORLD / 2,
      y: (notes[0]?.y ?? 0) + STICKY_SIZE_WORLD / 2,
    });
    expect(Math.abs(centre.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - CENTRE.y)).toBeLessThanOrEqual(1);
    // The camera is untouched by creating a note.
    expect(camera.zoom).toBe(1);
  });

  test('TC-37 deleting a note in the middle of a drag ends the interaction silently', async ({
    page,
  }) => {
    await openBoard(page);
    const doomed = await createNote(page);
    await page.keyboard.press('Escape');
    const kept = await createNote(page, { x: 400, y: 250 });
    await page.keyboard.press('Escape');

    const from = await noteCentre(page, doomed);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });

    await page.keyboard.press('Delete');
    await expect(noteLocator(page, doomed)).toHaveCount(0);

    // The pointer is still down and keeps moving: nothing throws, nothing is re-created.
    await page.mouse.move(from.x + 180, from.y + 160, { steps: 4 });
    await page.mouse.up();
    await waitForSettled(page);

    const notes = await readNotes(page);
    expect(notes.map((note) => note.id)).toEqual([kept]);
    // Deleting during a drag must not turn into a board pan.
    const camera = await readCamera(page);
    expect(camera.zoom).toBe(1);
  });

  test('TC-40 pasting beyond the limit keeps exactly 1,000 characters', async ({ page }) => {
    await openBoard(page);
    const id = await createNote(page);

    await page.keyboard.insertText(OVERLONG_TEXT);
    await waitForSettled(page);

    expect((await readNotes(page))[0]?.text).toBe(LONG_TEXT);
    const note = noteLocator(page, id);
    await expect(note.getByTestId('sticky-note-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
    await expect(page.getByTestId('sticky-note-editor')).toHaveValue(LONG_TEXT);

    // Typing more cannot push it over the limit either.
    await page.keyboard.type('abc');
    expect((await readNotes(page))[0]?.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  test('the character counter appears only near the limit', async ({ page }) => {
    await openBoard(page);
    await createNote(page);

    // 949 characters: still more than the counter threshold away from the limit.
    await page.keyboard.insertText('x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1));
    await expect(page.getByTestId('sticky-note-counter')).toHaveCount(0);

    // One more character brings it inside the threshold.
    await page.keyboard.insertText('y');
    await expect(page.getByTestId('sticky-note-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  test('sticky.text: typing, multi-line text and Escape keeps everything typed', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page);

    await page.keyboard.type('Weekly retro');
    await page.keyboard.press('Enter');
    await page.keyboard.type(RETRO_ITEM);
    await waitForSettled(page);

    // The text is in the shared state on every keystroke, not only when the edit ends.
    expect((await readNotes(page))[0]?.text).toBe(`Weekly retro\n${RETRO_ITEM}`);

    await page.keyboard.press('Escape');
    const note = noteLocator(page, id);
    await expect(note).toHaveAttribute('data-selected', 'true');
    await expect(note.getByTestId('sticky-note-text')).toContainText('Weekly retro');
    // A second Enter while the note is only selected starts editing again.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
    await expect(page.getByTestId('sticky-note-editor')).toHaveValue(
      `Weekly retro\n${RETRO_ITEM}`,
    );
  });

  test('sticky.text: Backspace and Delete belong to the text, never to the note', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page);

    await page.keyboard.type('ab');
    await page.keyboard.press('Backspace');
    await waitForSettled(page);
    expect((await readNotes(page))[0]?.text).toBe('a');

    await page.keyboard.press('Delete');
    await expect(noteLocator(page, id)).toHaveCount(1);

    // Only once the edit has ended does Delete remove the note.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await expect(noteLocator(page, id)).toHaveCount(0);
  });

  test('sticky.interaction: a click on the board clears the selection', async ({ page }) => {
    await openBoard(page);
    const id = await createNote(page);
    await page.keyboard.press('Escape');
    await selectNoteById(page, id);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();

    await page.mouse.click(200, 700);
    await expect(noteLocator(page, id)).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
  });

  test('sticky.interaction: clicking outside an editing note keeps the text and clears selection', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNote(page);

    await page.keyboard.type('kept by clicking away');
    await page.mouse.click(180, 680);
    await waitForSettled(page);

    expect((await readNotes(page))[0]?.text).toBe('kept by clicking away');
    await expect(page.getByTestId('sticky-note-editor')).toHaveCount(0);
    await expect(noteLocator(page, id)).toHaveAttribute('data-selected', 'false');
  });
});

/** The DOM normalises colours, so expected hex values are compared as `rgb()`. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
