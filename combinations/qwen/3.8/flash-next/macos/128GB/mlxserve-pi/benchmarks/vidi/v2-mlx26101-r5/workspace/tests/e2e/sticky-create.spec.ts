import { expect, test } from '@playwright/test';

import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  DEFAULT_STICKY_COLOR,
} from '../../src/shared/config';
import { LONG_PROSE_1000, SHORT_PHRASE } from '../fixtures/texts';
import {
  VIEWPORT,
  clickNote,
  doubleClickCreate,
  editorLocator,
  editorValue,
  expectNoteCount,
  expectNoteWorld,
  note,
  noteFontPx,
  noteIds,
  noteInteraction,
  noteScreenBox,
  noteText,
  noteWorld,
  openBoard,
  pressNoteAndMove,
  readCamera,
  setCamera,
  settled,
  toolbarCreate,
  waitForNoteAtRest,
} from './helpers/board';

const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.describe('creating sticky notes', () => {
  // TC-29, TC-30
  test('a real double-click on empty board space creates a note under the cursor and types into it', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await readCamera(page);

    const id = await doubleClickCreate(page, 400, 300);

    // Exactly one note exists, and the editor is focused so typing goes to it.
    await expectNoteCount(page, 1);
    await expect(editorLocator(page)).toBeFocused();
    expect(await noteInteraction(page, id)).toBe('editing');

    // It is centred on the point that was clicked: its box spans 400 +/- 100.
    const box = await noteScreenBox(page, id);
    expect(box.cx).toBeCloseTo(400, 0);
    expect(box.cy).toBeCloseTo(300, 0);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD * before.zoom, 0);

    await page.keyboard.type('Hello');
    expect(await editorValue(page)).toBe('Hello');

    await page.keyboard.press('Escape');
    await expect(editorLocator(page)).toHaveCount(0);
    expect(await noteText(page, id)).toBe('Hello');
    expect(await noteInteraction(page, id)).toBe('selected');

    // Creating and editing a note never moved the camera.
    expect(await readCamera(page)).toEqual(before);
  });

  // TC-29
  test('a note created while the camera is elsewhere lands on that part of the board', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: -3000, y: 2000, zoom: 1 });
    const camera = await readCamera(page);

    const id = await doubleClickCreate(page, 640, 400);

    // Screen (640, 400) with the camera at (-3000, 2000) is world (-2360, 2400).
    await expectNoteWorld(page, id, { x: -2360 - STICKY_SIZE_WORLD / 2, y: 2400 - STICKY_SIZE_WORLD / 2 });
    const world = await noteWorld(page, id);
    expect(world.x).toBeCloseTo(camera.x + 640 - STICKY_SIZE_WORLD / 2, 5);
    expect(world.y).toBeCloseTo(camera.y + 400 - STICKY_SIZE_WORLD / 2, 5);
  });

  // TC-30
  test('the toolbar button creates a note in the middle of the screen, ready to type', async ({
    page,
  }) => {
    await openBoard(page);

    const id = await toolbarCreate(page);

    await expectNoteCount(page, 1);
    // Centre of the screen in world coordinates, centred note.
    const camera = await readCamera(page);
    expect((await noteWorld(page, id)).x).toBeCloseTo(
      camera.x + CENTRE.x - STICKY_SIZE_WORLD / 2,
      5,
    );
    // The note box is centred on the screen and starts in the default colour.
    const box = await noteScreenBox(page, id);
    expect(box.cx).toBeCloseTo(CENTRE.x, 0);
    expect(box.cy).toBeCloseTo(CENTRE.y, 0);
    expect(await note(page, id).getAttribute('data-color')).toBe(DEFAULT_STICKY_COLOR);

    await page.keyboard.type(SHORT_PHRASE);
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe(SHORT_PHRASE);
  });

  // TC-30 (second part), plus note stacking of new notes
  test('a second click of the button creates a second note above the first', async ({ page }) => {
    await openBoard(page);

    const first = await toolbarCreate(page);
    await page.keyboard.press('Escape');
    const second = await toolbarCreate(page);

    await expectNoteCount(page, 2);
    expect(second).not.toBe(first);
    expect((await noteWorld(page, second)).z).toBeGreaterThan((await noteWorld(page, first)).z);
    // The two notes are on top of each other: the newest is painted last.
    expect(await noteIds(page)).toEqual([first, second]);
  });

  // TC-35 e2e companion: a double-click on a note edits it instead of creating one
  test('a double-click on a note edits it and creates nothing', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('Faster onboarding');
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe('Faster onboarding');

    // Double-click the middle of the note: the board must not create a note there.
    const box = await noteScreenBox(page, id);
    await page.mouse.dblclick(box.cx, box.cy);
    await expectNoteCount(page, 1);
    await expect(editorLocator(page)).toBeFocused();
    expect(await editorValue(page)).toBe('Faster onboarding');

    // Typing continues where the caret was: at the end of the text.
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe('Faster onboarding!');
    await expectNoteCount(page, 1);
  });

  // Selection: a note is an accessible, focusable group with a toolbar
  test('a clicked note is selected and shows its toolbar; a click on the board deselects it', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('abc');
    await page.keyboard.press('Escape');

    await clickNote(page, id);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    expect(await noteInteraction(page, id)).toBe('selected');

    // A press on empty board space: note and text stay, selection goes.
    await page.mouse.click(200, 700);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
    expect(await noteInteraction(page, id)).toBe('unselected');
    expect(await noteText(page, id)).toBe('abc');
    expect(await expectNoteCount(page, 1)).toHaveLength(1);
  });

  // TC-38 e2e: clicking outside commits and deselects
  test('a click outside the editor commits the text and leaves the note unselected', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('kept');
    await settled(page);

    await page.mouse.click(1100, 120);
    await expect(editorLocator(page)).toHaveCount(0);
    expect(await noteText(page, id)).toBe('kept');
    expect(await noteInteraction(page, id)).toBe('unselected');
    expect(await noteWorld(page, id).then((w) => w.z)).toBeGreaterThan(0);
  });

  // A note keeps its own pointer events: dragging it never pans the board
  test('dragging a note leaves the camera exactly where it was', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.press('Escape');
    const before = await readCamera(page);

    await pressNoteAndMove(page, id, 120, 80);
    // The note is being dragged, and the board is not panning.
    expect(await noteInteraction(page, id)).toBe('dragging');
    expect(await page.getByTestId('board-viewport').getAttribute('data-panning')).toBe('false');
    await page.mouse.up();

    await waitForNoteAtRest(page, id);
    expect(await readCamera(page)).toEqual(before);
    expect(await noteInteraction(page, id)).toBe('selected');
  });

  // The length limit is enforced in the browser too
  test('typing past the limit is clamped and shows the counter', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.insertText(LONG_PROSE_1000);
    await settled(page);
    expect(await editorValue(page)).toBe(LONG_PROSE_1000);
    await expect(page.getByTestId('sticky-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS} / ${STICKY_TEXT_MAX_CHARS}`,
    );

    // A paste that is too long keeps the first 1,000 characters.
    await page.keyboard.insertText('one too far');
    await settled(page);
    expect(await editorValue(page)).toBe(LONG_PROSE_1000);
    expect(await editorValue(page)).not.toContain('one too far');
    expect((await editorValue(page)).length).toBe(STICKY_TEXT_MAX_CHARS);
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe(LONG_PROSE_1000);
    expect(await noteFontPx(page, id)).toBeGreaterThanOrEqual(10);
  });
});
