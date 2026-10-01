import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_NOTE_1000, PASTE_1200 } from '../fixtures/texts';
import { gotoBoard, setCamera, settle } from './helpers/board';
import {
  cameraOf,
  clickNote,
  counter,
  createNoteAt,
  deleteButton,
  dragNote,
  editor,
  expectCentreAt,
  expectMovedBy,
  expectWorldAt,
  noteBox,
  noteCentre,
  noteColor,
  noteFontPx,
  noteHasFade,
  noteIds,
  noteSelected,
  noteState,
  noteText,
  noteToolbar,
  noteWorldPos,
  onlyNoteId,
  rgb,
  stickyButton,
  swatch,
  textBoxInside,
  topNoteIdAt,
  waitForNoteCount,
} from './helpers/stickies';

/**
 * Story 2 e2e: capture ideas on sticky notes and rearrange them.
 * Viewport is 1280 x 800 in every project, so the world origin starts at the
 * centre of the screen (640, 400).
 */

const SCREEN = { width: 1280, height: 800 };
const CENTRE = { x: SCREEN.width / 2, y: SCREEN.height / 2 };

/** Camera that puts the world origin at the centre of the screen at `zoom`. */
const centredAt = (zoom: number) => ({
  x: -SCREEN.width / 2 / zoom,
  y: -SCREEN.height / 2 / zoom,
  zoom,
});

test.describe('capturing an idea', () => {
  test('TC-30 double-clicks the board, types the idea and keeps the note', async ({ page }) => {
    await gotoBoard(page);

    await page.mouse.dblclick(400, 300);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('Hello');

    const id = await onlyNoteId(page);
    // The note is centred on the point that was double-clicked.
    await expectCentreAt(page, id, { x: 400, y: 300 });
    expect(await noteText(page, id)).toBe('Hello');
    expect(await noteColor(page, id)).toBe(rgb('yellow'));
    expect(await noteState(page, id)).toBe('editing');
    expect(await noteSelected(page, id)).toBe(true);
    // A short note shows no character counter.
    await expect(counter(page)).toHaveCount(0);

    // At 100 % the note is exactly the board size of a sticky note.
    const box = await noteBox(page, id);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
    expect(box.height).toBeCloseTo(STICKY_SIZE_WORLD, 0);

    // Escape finishes editing, keeps the text and selects the note.
    await page.keyboard.press('Escape');
    expect(await noteState(page, id)).toBe('selected');
    expect(await noteText(page, id)).toBe('Hello');
    await expect(noteToolbar(page)).toBeVisible();
    expect(await editor(page).count()).toBe(0);
  });

  test('TC-31 drags a note at 50 % zoom, the grabbed point staying under the pointer', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, centredAt(0.5));
    await settle(page);
    const camera = await cameraOf(page);

    await stickyButton(page).click();
    await page.keyboard.type('Move me');
    await page.keyboard.press('Escape');
    const id = await onlyNoteId(page);
    const beforeScreen = await noteCentre(page, id);
    const beforeWorld = await noteWorldPos(page, id);

    await dragNote(page, id, 100, 50);

    // On screen the note followed the pointer exactly: the point that was
    // grabbed is still under it.
    await expectMovedBy(page, id, beforeScreen, 100, 50);
    // In the document the move is twice as large in board units at 50 % zoom.
    await expectWorldAt(page, id, beforeWorld.x + 200, beforeWorld.y + 100);
    expect(await noteState(page, id)).toBe('selected');
    // Dragging a note never pans the board.
    expect(await cameraOf(page)).toEqual(camera);
  });

  test('TC-32 drags a note at 200 % zoom and draws it above the note it overlaps', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, centredAt(2));
    await settle(page);
    const camera = await cameraOf(page);

    // Two notes, created one beside the other so they overlap by a quarter:
    // at 200 % each is a 400 px square on screen.
    const bottom = await createNoteAt(page, CENTRE, 'Bottom');
    const top = await createNoteAt(page, { x: CENTRE.x + 250, y: CENTRE.y }, 'Top');
    const overlap = { x: 750, y: 400 }; // inside both squares
    // The note created later is the one painted here.
    expect(await topNoteIdAt(page, overlap)).toBe(top);

    // Grab the first note where only it is, and drag it over the second one.
    const beforeWorld = await noteWorldPos(page, bottom);
    await dragNote(page, bottom, 100, 50);

    // 100 and 50 screen pixels at 200 % zoom are 50 and 25 board units.
    await expectWorldAt(page, bottom, beforeWorld.x + 50, beforeWorld.y + 25);
    // The dragged note is now the one painted on top.
    expect(await topNoteIdAt(page, overlap)).toBe(bottom);
    expect(await noteState(page, bottom)).toBe('selected');
    expect(await cameraOf(page)).toEqual(camera);
  });

  test('recolours a note with a swatch and deletes another one with the keyboard', async ({
    page,
  }) => {
    await gotoBoard(page);
    const milk = await createNoteAt(page, { x: 320, y: 240 }, 'Buy milk');
    const login = await createNoteAt(page, { x: 640, y: 240 }, 'Fix login');
    const venue = await createNoteAt(page, { x: 960, y: 240 }, 'Call the venue');
    await waitForNoteCount(page, 3);

    await clickNote(page, milk);
    await swatch(page, 'green').click();
    expect(await noteColor(page, milk)).toBe(rgb('green'));
    // Recolouring keeps the note selected and its text as it was.
    expect(await noteSelected(page, milk)).toBe(true);
    expect(await noteText(page, milk)).toBe('Buy milk');
    expect(await swatch(page, 'green').getAttribute('aria-pressed')).toBe('true');

    await clickNote(page, login);
    await page.keyboard.press('Delete');

    const remaining = await waitForNoteCount(page, 2);
    expect(remaining).toEqual(expect.arrayContaining([milk, venue]));
    expect(remaining).not.toContain(login);
    expect(await noteText(page, venue)).toBe('Call the venue');
    await expect(noteToolbar(page)).toHaveCount(0);
  });

  test('deletes the selected note with the bin button', async ({ page }) => {
    await gotoBoard(page);
    const first = await createNoteAt(page, { x: 480, y: 400 }, 'Keep me');
    const second = await createNoteAt(page, { x: 880, y: 400 }, 'Throw me away');

    await clickNote(page, second);
    await expect(noteToolbar(page)).toBeVisible();
    await deleteButton(page).click();

    const remaining = await waitForNoteCount(page, 1);
    expect(remaining).toEqual([first]);
    await expect(noteToolbar(page)).toHaveCount(0);
    expect(await noteSelected(page, first)).toBe(false);
  });
});

test.describe('notes and the board', () => {
  test('TC-34 creates a note in the middle of the screen after panning far away', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, { x: -SCREEN.width / 2 - 4800, y: -SCREEN.height / 2 - 3200, zoom: 1 });
    await settle(page);
    const camera = await cameraOf(page);

    await stickyButton(page).click();

    const id = await onlyNoteId(page);
    await expectCentreAt(page, id, CENTRE);
    await expect(editor(page)).toBeVisible();
    expect(await noteSelected(page, id)).toBe(true);
    // Creating a note never moves the board.
    expect(await cameraOf(page)).toEqual(camera);
  });

  test('keeps the note toolbar the same size on screen at every zoom', async ({ page }) => {
    await gotoBoard(page);
    const id = await createNoteAt(page, CENTRE, 'Zoom me');
    const atOneHundred = await swatch(page, 'pink').boundingBox();

    await setCamera(page, centredAt(2));
    await settle(page);
    await clickNote(page, id);
    const atTwoHundred = await swatch(page, 'pink').boundingBox();

    expect(atOneHundred).not.toBeNull();
    expect(atTwoHundred).not.toBeNull();
    // The toolbar is scaled by 1 / zoom, so its screen size does not change.
    expect(atTwoHundred!.height).toBeCloseTo(atOneHundred!.height, 0);
    expect(atTwoHundred!.width).toBeCloseTo(atOneHundred!.width, 0);
    // The note itself does scale with the board.
    expect((await noteBox(page, id)).width).toBeCloseTo(STICKY_SIZE_WORLD * 2, 0);
  });

  test('never pans the board when a note is dragged, and never edits when the board is clicked', async ({
    page,
  }) => {
    await gotoBoard(page);
    const id = await createNoteAt(page, { x: 500, y: 300 }, 'Still here');
    const camera = await cameraOf(page);

    await dragNote(page, id, 120, -60);
    expect(await cameraOf(page)).toEqual(camera);

    // A click on empty board space deselects without opening anything.
    await clickNote(page, id);
    expect(await noteSelected(page, id)).toBe(true);
    await page.mouse.click(200, 700);
    expect(await noteSelected(page, id)).toBe(false);
    await expect(noteToolbar(page)).toHaveCount(0);
    expect(await cameraOf(page)).toEqual(camera);
  });
});

test.describe('long text in a note', () => {
  test('TC-33 shrinks the font to fit and fades what cannot fit', async ({ page }) => {
    await gotoBoard(page);
    const id = await createNoteAt(page, CENTRE, 'Team');

    // One word is shown at the largest readable size, with nothing clipped.
    expect(await noteFontPx(page, id)).toBe(STICKY_FONT_MAX_PX);
    expect(await noteHasFade(page, id)).toBe(false);

    // Replace it with 1,000 characters of prose.
    const centre = await noteCentre(page, id);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.insertText(LONG_NOTE_1000);

    const typed = await noteText(page, id);
    expect(typed.length).toBe(STICKY_TEXT_MAX_CHARS);
    // The counter appears at the limit.
    await expect(counter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    await page.keyboard.press('Escape');

    // The text shrank to the smallest readable size and is faded where it is
    // clipped; nothing of it is drawn outside the note.
    const fontPx = await noteFontPx(page, id);
    expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(await noteHasFade(page, id)).toBe(true);
    const box = await textBoxInside(page, id);
    expect(box).toEqual({ inside: true, clipped: true });
    expect((await noteBox(page, id)).width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  });

  test('drops the characters of a paste that go past the limit', async ({ page }) => {
    await gotoBoard(page);

    await page.mouse.dblclick(CENTRE.x, CENTRE.y);
    await page.keyboard.insertText(PASTE_1200);

    const id = await onlyNoteId(page);
    expect((await noteText(page, id)).length).toBe(STICKY_TEXT_MAX_CHARS);
    await expect(counter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    // Everything kept is still in the document after editing ends.
    await page.keyboard.press('Escape');
    expect((await noteText(page, id)).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(await noteHasFade(page, id)).toBe(true);
  });

  test('keeps a multi-line note without scrolling it out of the note', async ({ page }) => {
    await gotoBoard(page);
    // The note is created empty and typed into, so its text is exactly what
    // was typed, newlines included.
    await page.mouse.dblclick(CENTRE.x, CENTRE.y);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('Keep\ndrop\nmore');
    const id = await onlyNoteId(page);
    expect(await noteText(page, id)).toBe('Keep\ndrop\nmore');

    await page.keyboard.press('Escape');
    expect(await noteHasFade(page, id)).toBe(false);
    expect((await textBoxInside(page, id)).inside).toBe(true);
  });
});
