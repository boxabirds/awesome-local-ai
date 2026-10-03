import { expect, test } from './fixtures.js';
import {
  CENTRE,
  DRAG,
  cameraState,
  expectNear,
  expectPointNear,
  openBoard,
  pixelLightnessRange,
  setCamera,
  waitForRender,
  zoomLabel,
} from './helpers/board.js';
import {
  BOARD_CENTRE,
  binButton,
  colorSwatch,
  counter,
  createNote,
  docNotes,
  doubleClickBoard,
  dragNote,
  escapeEditing,
  noteAt,
  noteBox,
  noteById,
  noteCentre,
  noteCount,
  noteData,
  noteFontSize,
  noteText,
  noteTextOverflows,
  noteToolbar,
  pasteIntoNote,
  stickyEditor,
  stickyToolbarButton,
  topNoteId,
  typeIntoNote,
  waitForNoteCount,
} from './helpers/sticky.js';
import { PROSE_1200, SHORT_TEXT } from '../fixtures/texts.js';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config.js';

/**
 * sticky.interaction / sticky.text / sticky.toolbar (e2e): the tests that need a
 * real browser - hit-testing, real font layout, real pointer capture - and the
 * workflows that string the gestures together.
 *
 * The view starts with the board's origin (world 0,0) in the middle of the screen
 * at 100%, so a note created there is drawn from (540,300) to (740,500).
 */

/** The camera that puts world (0,0) in the middle of the screen at a given zoom. */
const viewAt = (zoom: number) => ({
  x: -CENTRE.x / zoom,
  y: -CENTRE.y / zoom,
  zoom,
});

test('TC-30 creates a note by double-clicking the board and types into it', async ({ page }) => {
  await openBoard(page);

  await doubleClickBoard(page, { x: 400, y: 300 });

  await waitForNoteCount(page, 1);
  // The note is centred on the point that was double-clicked.
  expectPointNear(await noteCentre(page, 0), { x: 400, y: 300 }, 1, 'note centre');
  expect(await noteToolbar(page).count()).toBe(0);

  await typeIntoNote(page, 'Hello');

  expect(await noteText(page, 0)).toBe('Hello');
  // A short note is drawn at the largest font size.
  expectNear(await noteFontSize(page, 0), 24, 0.5, 'font size');

  await escapeEditing(page);
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');
  await expect(noteToolbar(page)).toBeVisible();
});

test('TC-31 drags a note at 50% and the grabbed point stays under the pointer', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, viewAt(0.5));
  await createNote(page);
  await escapeEditing(page);

  const before = await noteData(page, 0);
  // At 50% the note is half as wide on screen as its 200 world units.
  expectNear((await noteBox(page, 0)).width, 100, 1, 'note width');

  const grab = await noteCentre(page, 0);
  await dragNote(page, grab, { x: grab.x + DRAG.x / 2, y: grab.y + DRAG.y / 2 });

  const after = await noteData(page, 0);
  // 100 screen px at 50% is 200 world units.
  expectNear(after.x - before.x, DRAG.x, 1, 'world dx');
  expectNear(after.y - before.y, DRAG.y, 1, 'world dy');
  // And the point that was grabbed is where the pointer is now.
  expectPointNear(await noteCentre(page, 0), { x: grab.x + DRAG.x / 2, y: grab.y + DRAG.y / 2 }, 1, 'note centre');
  // Dragging a note never panned the board.
  expectNear((await cameraState(page)).zoom, 0.5, 9, 'zoom');
});

test('TC-32 drags a note at 200% and draws it above the note it overlaps', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, viewAt(2));

  // Two notes on top of each other at the middle of the view.
  await createNote(page);
  await escapeEditing(page);
  await createNote(page);
  await escapeEditing(page);
  await waitForNoteCount(page, 2);
  const bottom = await noteData(page, 0);
  const top = await noteData(page, 1);

  // Move the top note aside so the two only overlap partially.
  const beforeTop = await noteById(page, top.id);
  await dragNote(page, CENTRE, { x: CENTRE.x + 150, y: CENTRE.y });
  await expect
    .poll(() => topNoteId(page, CENTRE), { message: 'the top note did not follow the drag' })
    .toBe(top.id);
  // 150 screen px at 200% is 75 world units.
  expectNear((await noteById(page, top.id)).x - beforeTop.x, 75, 1, 'world dx of the top note');

  // Grab the bottom note where only it is exposed and drag it over the other.
  const exposed = { x: CENTRE.x - 140, y: CENTRE.y };
  expect(await topNoteId(page, exposed)).toBe(bottom.id);
  const before = await noteById(page, bottom.id);
  await dragNote(page, exposed, { x: exposed.x + 100, y: exposed.y + 50 });

  const after = await noteById(page, bottom.id);
  // 100 and 50 screen px at 200% are 50 and 25 world units.
  expectNear(after.x - before.x, 50, 1, 'world dx');
  expectNear(after.y - before.y, 25, 1, 'world dy');
  // It is now the note that wins at a point where the two overlap.
  expect(await topNoteId(page, CENTRE)).toBe(after.id);
  // The document agrees: the dragged note is drawn last, the other one unchanged.
  const notes = await docNotes(page);
  expect(notes.map((note) => note.id)).toEqual([top.id, after.id]);
  expectNear(notes[0]?.z ?? 0, top.z, 9, 'unchanged note z');
  expect((notes[1]?.z ?? 0) > (notes[0]?.z ?? 0)).toBe(true);
});

test('TC-33 fits the text down as the note fills up, then clips it', async ({ page }) => {
  await openBoard(page);
  await createNote(page);

  // One word: the largest font size.
  await typeIntoNote(page, 'Retro');
  expectNear(await noteFontSize(page, 0), 24, 0.5, 'font size of a short note');
  expect(await noteTextOverflows(page, 0)).toBe(false);

  // 1,200 characters pasted at once: only the first 1,000 are kept, and the text
  // is fitted down until it stops spilling out of the note.
  await pasteIntoNote(page, PROSE_1200);

  const text = await noteText(page, 0);
  expect(text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  const fontPx = await noteFontSize(page, 0);
  expect(fontPx).toBeGreaterThanOrEqual(10);
  expect(fontPx).toBeLessThanOrEqual(24);
  expectNear(fontPx, 10, 0.5, 'font size at the limit');
  // The text no longer fits: it is clipped inside the note, and the note says so.
  expect(await noteTextOverflows(page, 0)).toBe(true);
  await expect(noteAt(page, 0)).toHaveAttribute('data-overflow', 'true');
  await expect(page.getByTestId('sticky-fade')).toBeVisible();

  // Nothing is rendered outside the note: the strip of board below its bottom
  // edge is plain board, while the note itself holds dark text pixels.
  const box = await noteBox(page, 0);
  const below = await pixelLightnessRange(page, { x: box.x + box.width / 2, y: box.y + box.height + 20 }, 12);
  const inside = await pixelLightnessRange(page, { x: box.x + box.width / 2, y: box.y + box.height - 12 }, 12);
  expect(below[1] - below[0]).toBeLessThan(12);
  expect(inside[0]).toBeLessThan(160);

  // Deleting the text brings the large font back.
  await pasteIntoNote(page, 'One more');
  expectNear(await noteFontSize(page, 0), 24, 0.5, 'font size after shortening');
  await expect(page.getByTestId('sticky-fade')).toHaveCount(0);
});

test('TC-34 creates a note in the middle of the view far away from the origin', async ({ page }) => {
  await openBoard(page);
  // The user travelled far across the board.
  await setCamera(page, { x: 100_000, y: -80_000, zoom: 1 });

  await createNote(page);

  await waitForNoteCount(page, 1);
  // The note appears where the user is looking, not at the board's origin.
  expectPointNear(await noteCentre(page, 0), BOARD_CENTRE, 1, 'note centre');
  await expect(noteAt(page, 0)).toBeInViewport();
  // The world point under the middle of the screen is 100,000 + 640 / 1, and the
  // note's own coordinates are its top-left corner, one half note to the north-west.
  expectNear((await noteData(page, 0)).x, 100_000 + CENTRE.x - 100, 1, 'world x of the new note');
  expectNear((await noteData(page, 0)).y, -80_000 + CENTRE.y - 100, 1, 'world y of the new note');
});

test('TC-16 counts down the last 50 characters in the browser too', async ({ page }) => {
  await openBoard(page);
  await createNote(page);

  await pasteIntoNote(page, 'x'.repeat(949));
  await expect(counter(page)).toHaveCount(0);

  await pasteIntoNote(page, 'x'.repeat(951));
  await expect(counter(page)).toHaveText('951/1000');

  await pasteIntoNote(page, PROSE_1200);
  await expect(counter(page)).toHaveText('1000/1000');
  expect((await noteText(page, 0)).length).toBe(STICKY_TEXT_MAX_CHARS);
});

test('selects a note with a click and deselects with a click on empty board space', async ({
  page,
}) => {
  await openBoard(page);
  await createNote(page);
  await typeIntoNote(page, 'Retro board');
  await escapeEditing(page);
  await expect(noteToolbar(page)).toBeVisible();

  // Click empty board space: the selection and the note toolbar go away.
  await page.mouse.click(200, 620);
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'false');
  await expect(noteToolbar(page)).toHaveCount(0);

  // A press that does not move selects again, and does not move the note.
  const before = await noteData(page, 0);
  await dragNote(page, CENTRE, CENTRE, 1);
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');
  expectNear((await noteData(page, 0)).x, before.x, 9, 'world x');

  // Double-clicking the note opens it with the caret at the end of its text.
  await page.mouse.dblclick(CENTRE.x, CENTRE.y);
  await expect(stickyEditor(page)).toBeFocused();
  expect(await stickyEditor(page).inputValue()).toBe('Retro board');
  const caret = await stickyEditor(page).evaluate((element) => (element as HTMLTextAreaElement).selectionStart);
  expectNear(caret ?? 0, 11, 0, 'caret');
  await expect(noteCount(page)).resolves.toBe(1);
});

test('a press of two pixels selects without moving the note', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await escapeEditing(page);

  const before = await noteData(page, 0);
  await dragNote(page, CENTRE, { x: CENTRE.x + 2, y: CENTRE.y }, 2);

  expectNear((await noteData(page, 0)).x, before.x, 9, 'world x');
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');
});

test('dragging a note never pans the board', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await escapeEditing(page);
  const cameraBefore = await cameraState(page);
  const noteBefore = await noteData(page, 0);

  const grab = await noteCentre(page, 0);
  await dragNote(page, grab, { x: grab.x + 300, y: grab.y + 200 });

  const cameraAfter = await cameraState(page);
  expectNear(cameraAfter.x, cameraBefore.x, 9, 'camera x');
  expectNear(cameraAfter.y, cameraBefore.y, 9, 'camera y');
  expectNear(cameraAfter.zoom, cameraBefore.zoom, 9, 'camera zoom');
  // The note moved instead: 300 and 200 screen px at 100% are 300 and 200 world units.
  const after = await noteData(page, 0);
  expectNear(after.x - noteBefore.x, 300, 1, 'world dx');
  expectNear(after.y - noteBefore.y, 200, 1, 'world dy');
});

test('TC-27 recolours the selected note without moving it', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await typeIntoNote(page, 'Retro board');
  await escapeEditing(page);

  const before = await noteData(page, 0);
  await expect(colorSwatch(page, 'yellow')).toHaveAttribute('aria-pressed', 'true');
  await colorSwatch(page, 'pink').click();
  await waitForRender(page);

  const after = await noteData(page, 0);
  expect(after.color).toBe('pink');
  expect(after.text).toBe('Retro board');
  expectNear(after.x, before.x, 9, 'world x');
  expectNear(after.y, before.y, 9, 'world y');
  expectNear(after.z, before.z, 9, 'z');
  // The note is drawn in the new colour, and stays selected.
  await expect(noteAt(page, 0)).toHaveAttribute('data-color', 'pink');
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');
  await expect(colorSwatch(page, 'pink')).toHaveAttribute('aria-pressed', 'true');
  // The note keeps its size on screen: only its colour changed.
  expectNear((await noteBox(page, 0)).width, 200, 1, 'note width');
});

test('TC-29 deletes the note with the bin button and clears the selection', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await escapeEditing(page);

  await binButton(page).click();

  await waitForNoteCount(page, 0);
  await expect(noteToolbar(page)).toHaveCount(0);
  expect(await noteCount(page)).toBe(0);
});

test('golden path: brainstorm a note, move it at 50%, recolour it, delete it', async ({ page }) => {
  await openBoard(page);

  // 1. Capture the idea where the pointer is.
  await doubleClickBoard(page, { x: 400, y: 300 });
  // The note's text contains an "n": the shortcut must not fire while typing.
  await typeIntoNote(page, SHORT_TEXT);
  await escapeEditing(page);
  expectNear(await noteFontSize(page, 0), 24, 0.5, 'font size');

  // 2. Rearrange it while zoomed out.
  await setCamera(page, viewAt(0.5));
  const beforeMove = await noteData(page, 0);
  const grab = await noteCentre(page, 0);
  await dragNote(page, grab, { x: grab.x + 120, y: grab.y + 60 });
  const afterMove = await noteData(page, 0);
  expectNear(afterMove.x - beforeMove.x, 240, 1, 'world dx at 50%');
  expectNear(afterMove.y - beforeMove.y, 120, 1, 'world dy at 50%');
  // Dragging at 50% keeps the note selected, which is what the swatch needs.
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');

  // 3. Give it a colour.
  await colorSwatch(page, 'green').click();
  await waitForRender(page);
  expect((await noteData(page, 0)).color).toBe('green');

  // 4. Remove it with the keyboard: the board is empty again, and nothing is left
  // selected, so a second Delete press has nothing to remove.
  await page.keyboard.press('Delete');
  await waitForNoteCount(page, 0);
  expect(await noteCount(page)).toBe(0);
  await expect(stickyEditor(page)).toHaveCount(0);
  await page.keyboard.press('Delete');
  expect(await noteCount(page)).toBe(0);
  // The board itself is unaffected by all of it.
  await expect(zoomLabel(page)).toHaveText('50%');
});

test('the note toolbar and the counter keep their size while the board is zoomed', async ({
  page,
}) => {
  await openBoard(page);
  await createNote(page);
  await pasteIntoNote(page, 'x'.repeat(980));

  // A toolbar and a counter are page chrome: they stay the same size on screen
  // however far the board is zoomed, while the note itself grows and shrinks.
  const toolbarHeight = async (): Promise<number> => {
    const box = await noteToolbar(page).boundingBox();
    if (!box) throw new Error('the note toolbar is not drawn');
    return box.height;
  };
  const counterHeight = async (): Promise<number> => {
    const box = await counter(page).boundingBox();
    if (!box) throw new Error('the counter is not drawn');
    return box.height;
  };

  const counterAt100 = await counterHeight();
  const noteAt100 = (await noteBox(page, 0)).width;
  await escapeEditing(page);
  const toolbarAt100 = await toolbarHeight();

  await setCamera(page, viewAt(0.5));
  await expect(stickyToolbarButton(page)).toBeVisible();
  expectNear(await toolbarHeight(), toolbarAt100, 1, 'toolbar height at 50%');
  expectNear((await noteBox(page, 0)).width, noteAt100 / 2, 1, 'note width at 50%');

  await setCamera(page, viewAt(2));
  expectNear(await toolbarHeight(), toolbarAt100, 1, 'toolbar height at 200%');
  expectNear((await noteBox(page, 0)).width, noteAt100 * 2, 1, 'note width at 200%');

  // The counter keeps its size too, when editing is opened again at this zoom.
  await page.mouse.dblclick(CENTRE.x, CENTRE.y);
  await expect(counter(page)).toBeVisible();
  expectNear(await counterHeight(), counterAt100, 1, 'counter height at 200%');
});

test('a note is reachable with Tab and editable with Enter', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await typeIntoNote(page, 'Retro board');
  await escapeEditing(page);

  // Keyboard only: Tab until a note has the focus (the toolbars come first).
  const focusedNoteId = (): Promise<string | null> =>
    page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.closest('[data-note-id]')?.getAttribute(
          'data-note-id',
        ) ?? null,
    );
  const id = (await noteData(page, 0)).id;
  let reached = await focusedNoteId();
  for (let presses = 0; presses < 6 && reached === null; presses += 1) {
    await page.keyboard.press('Tab');
    reached = await focusedNoteId();
  }
  expect(reached).toBe(id);

  // Enter on the focused note opens it with the caret at the end.
  await page.keyboard.press('Enter');
  await expect(stickyEditor(page)).toBeFocused();
  expect(await stickyEditor(page).inputValue()).toBe('Retro board');

  await page.keyboard.type(' too');
  expect((await noteText(page, 0)).endsWith('Retro board too')).toBe(true);

  // The Sticky note button is reachable and named before any note exists too.
  await page.reload();
  await expect(stickyToolbarButton(page)).toBeVisible();
});

test('an empty note stays on the board and shows no placeholder', async ({ page }) => {
  await openBoard(page);
  await createNote(page);
  await escapeEditing(page);

  // A blank note is a note: it stays, and nothing is drawn inside it.
  await waitForNoteCount(page, 1);
  await expect(page.getByTestId('sticky-text')).toHaveText('');
  expect(await page.evaluate(() => document.querySelector('textarea')?.placeholder ?? null)).toBeNull();
  await expect(noteAt(page, 0)).toHaveAttribute('data-selected', 'true');

  // Typing into it afterwards behaves the same as on a note with text.
  await page.mouse.dblclick(CENTRE.x, CENTRE.y);
  await typeIntoNote(page, 'Now it has text');
  expect(await noteText(page, 0)).toBe('Now it has text');
});
