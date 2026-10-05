/**
 * e2e tests for sticky notes (story 2, TC-30 to TC-34).
 *
 * These run in a real browser, so they check what a jsdom test cannot: where a note is
 * actually painted, that the point of a note that was grabbed really does stay under
 * the pointer at every zoom, that a note is drawn above the notes it crosses, and that
 * long text is laid out inside the note with its bottom faded. The camera is fixed from
 * outside with `window.__vidi6`, as in story 1; the notes themselves are driven with
 * real mouse and keyboard input, and read back from the page's own document.
 */
import { expect, test } from '@playwright/test';

import { LONG_NOTE, RETRO_NOTE, SHORT_NOTE, TOO_LONG_NOTE } from '../fixtures/texts';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  BOARD_AREA,
  DRAG_DOWN,
  DRAG_RIGHT,
  TOLERANCE_PX,
  expectPixels,
  getCamera,
  openBoard,
  setCamera,
  settled,
  worldToScreen,
  zoomLabel,
} from './helpers/board';
import {
  actualCentre,
  boxOf,
  counter,
  createNote,
  deleteButton,
  doubleClickBoard,
  dragNote,
  editor,
  fade,
  grabbedPoint,
  lastNoteId,
  noteAppearance,
  noteAt,
  noteBox,
  noteCount,
  noteToolbar,
  notes,
  paintedIds,
  pasteIntoEditor,
  startEditingNote,
  startNote,
  stickyButton,
  stickies,
  swatch,
  textLayout,
} from './helpers/sticky';

const MIDDLE = { x: BOARD_AREA.width / 2, y: BOARD_AREA.height / 2 };
const CREATE_AT = { x: 400, y: 300 };
/** Screen travel of a note drag in these tests, as the PRD describes it. */
const NOTE_DX = 100;
const NOTE_DY = 50;

/** The centre of the note that is painted at `index`, on screen. */
async function centreOf(page: Parameters<typeof noteBox>[0], index = 0): Promise<{ x: number; y: number }> {
  return actualCentre(await noteBox(page, index));
}

test('TC-30: a double-click makes a note centred on the point, and the keys type into it', async ({ page }) => {
  await openBoard(page);
  const opening = await settled(page);

  await doubleClickBoard(page, CREATE_AT);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type('Hello');

  await expect.poll(() => noteCount(page)).toBe(1);
  const note = (await stickies(page))[0];
  expect(note.text).toBe('Hello');
  expect(note.type).toBe('sticky');
  // The note is centred on the point that was double-clicked, to within a pixel.
  const centre = await centreOf(page);
  const expected = worldToScreen(opening, { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 });
  expectPixels(centre.x, expected.x, 'the note is centred horizontally on the click');
  expectPixels(centre.y, expected.y, 'the note is centred vertically on the click');
  expectPixels(centre.x, CREATE_AT.x, 'which is the point in the test');
  expectPixels(centre.y, CREATE_AT.y, 'which is the point in the test');
  // At the size the settings give it.
  const box = await noteBox(page);
  expectPixels(box.width, STICKY_SIZE_WORLD * opening.zoom, 'note width');
  expectPixels(box.height, STICKY_SIZE_WORLD * opening.zoom, 'note height');
});

test('TC-30b: the toolbar button puts a note in the middle of what is on screen', async ({ page }) => {
  await openBoard(page);
  await expect(stickyButton(page)).toBeVisible();

  await stickyButton(page).click();

  await expect.poll(() => noteCount(page)).toBe(1);
  const centre = await centreOf(page);
  expectPixels(centre.x, MIDDLE.x, 'the new note is in the middle of the board area');
  expectPixels(centre.y, MIDDLE.y, 'the new note is in the middle of the board area');
  // Ready for typing without another click.
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type(SHORT_NOTE);
  await expect.poll(async () => (await stickies(page))[0].text).toBe(SHORT_NOTE);
});

test('TC-31: at 50% zoom a dragged note moves by the pointer travel divided by the zoom', async ({ page }) => {
  await openBoard(page);
  const noteId = await createNote(page, CREATE_AT, 'Half size');
  await setCamera(page, { zoom: 0.5 });

  const before = (await stickies(page))[0];
  const camera = await getCamera(page);
  const grab = await centreOf(page);
  const held = grabbedPoint(camera, before, grab);

  await dragNote(page, grab, NOTE_DX, NOTE_DY);

  const after = (await stickies(page))[0];
  // 100 by 50 screen pixels at half zoom is 200 by 100 board units.
  expect(after.x - before.x).toBeCloseTo(NOTE_DX / 0.5, 1);
  expect(after.y - before.y).toBeCloseTo(NOTE_DY / 0.5, 1);
  // The point that was grabbed is still under the pointer, to within a pixel.
  const under = worldToScreen(camera, { x: after.x + held.x, y: after.y + held.y });
  expectPixels(under.x, grab.x + NOTE_DX, 'the grabbed point follows the pointer horizontally');
  expectPixels(under.y, grab.y + NOTE_DY, 'the grabbed point follows the pointer vertically');
  expect(after.id).toBe(noteId);
  expect(after.text, 'dragging does not touch the text').toBe('Half size');
  expect(after.color, 'nor the colour').toBe('yellow');
  // The board itself did not move.
  expect(await getCamera(page)).toEqual(camera);
});

test('TC-32: at 200% zoom a dragged note moves by half the pointer travel, over the note it crosses', async ({ page }) => {
  await openBoard(page);
  const bottom = await createNote(page, { x: 300, y: 300 }, 'under');
  await createNote(page, { x: 760, y: 300 }, 'over');
  await setCamera(page, { zoom: 2 });

  const before = await stickies(page);
  const camera = await getCamera(page);
  const moved = before.find((note) => note.id === bottom)!;
  // Which note is on top before the drag: the one painted last.
  const paintedBefore = await paintedIds(page);
  const grab = worldToScreen(camera, { x: moved.x + 30, y: moved.y + 30 });

  await dragNote(page, grab, NOTE_DX, NOTE_DY);

  const after = await stickies(page);
  const movedAfter = after.find((note) => note.id === bottom)!;
  // 100 by 50 screen pixels at double zoom is 50 by 25 board units.
  expect(movedAfter.x - moved.x).toBeCloseTo(NOTE_DX / 2, 1);
  expect(movedAfter.y - moved.y).toBeCloseTo(NOTE_DY / 2, 1);
  // The dragged point stayed under the pointer.
  const held = grabbedPoint(camera, moved, grab);
  const under = worldToScreen(camera, { x: movedAfter.x + held.x, y: movedAfter.y + held.y });
  expectPixels(under.x, grab.x + NOTE_DX, 'the grabbed point follows the pointer');
  expectPixels(under.y, grab.y + NOTE_DY, 'the grabbed point follows the pointer');
  // It is drawn above the note it crossed, and nothing else changed.
  const paintedAfter = await paintedIds(page);
  expect(paintedAfter[paintedAfter.length - 1]).toBe(bottom);
  expect(paintedBefore).toHaveLength(2);
  expect(after).toHaveLength(2);
  expect(after.find((note) => note.id !== bottom)?.text).toBe('over');
});

test('TC-33: text that does not fit shrinks, and its bottom fades inside the note instead of spilling out', async ({ page }) => {
  await openBoard(page);
  await startNote(page, CREATE_AT, 'Fits');

  // One word: the largest size the settings allow.
  expect(await editor(page).evaluate((element) => getComputedStyle(element).fontSize)).toBe(`${STICKY_FONT_MAX_PX}px`);
  await page.keyboard.press('Escape');
  expect((await noteAppearance(page)).overflow).toBe('false');
  expect((await textLayout(page)).overflow).toBeLessThanOrEqual(0.5);

  // A note full of prose: the font comes down, and at the smallest size there is
  // still more text than the note can show — which is what the fade is for.
  await startEditingNote(page);
  await pasteIntoEditor(page, LONG_NOTE);
  await page.keyboard.press('Escape'); // fit and fade are what the note shows when it is not held
  await expect.poll(async () => (await noteAppearance(page)).fontSize).toBeLessThan(STICKY_FONT_MAX_PX);
  const fitted = await noteAppearance(page);
  expect(fitted.fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fitted.overflow, 'even the smallest size leaves text to fade').toBe('true');

  const layout = await textLayout(page);
  expect(layout.content, 'the note holds more text than it shows').toBeGreaterThan(layout.visible);
  expect(layout.overflow).toBeGreaterThan(0);
  // The painted note does not grow with its text: it stays the size the settings give it.
  expectPixels((await noteBox(page)).height, STICKY_SIZE_WORLD, 'the note keeps its size');
  // The fade sits over the bottom of the text: full opacity, and its own height.
  await expect(fade(page)).toBeVisible();
  const fadeStyle = await fade(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { image: style.backgroundImage, opacity: Number.parseFloat(style.opacity), height: Number.parseFloat(style.height) };
  });
  expect(fadeStyle.image).toContain('linear-gradient');
  expect(fadeStyle.opacity).toBeCloseTo(1, 2);
  expect(fadeStyle.height).toBeGreaterThan(0);

  // The fade is at the bottom of the note, and the text runs under it.
  const note = await noteBox(page);
  const fadeBox = await boxOf(fade(page));
  expectPixels(fadeBox.x + fadeBox.width, note.x + note.width, 'the fade spans the note');
  expectPixels(fadeBox.y + fadeBox.height, note.y + note.height, 'the fade ends at the note’s bottom edge');
});

test('TC-33b: a note typed past the limit keeps the first thousand characters and counts them', async ({ page }) => {
  await openBoard(page);
  await startNote(page, CREATE_AT, 'x');

  await pasteIntoEditor(page, TOO_LONG_NOTE);

  await expect.poll(async () => (await stickies(page))[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);
  expect((await stickies(page))[0].text).toBe(TOO_LONG_NOTE.slice(0, STICKY_TEXT_MAX_CHARS));
  await expect(counter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  // One more character is refused, so the note never holds more than it may.
  await page.keyboard.type('!');
  expect((await stickies(page))[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  // A note with more room than the counter threshold shows no counter at all.
  await page.keyboard.press('Escape');
  await startEditingNote(page);
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 5));
  await expect(counter(page), 'the counter is only for the last 50 characters').toHaveCount(0);
  expect((await stickies(page))[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 5);
});

test('TC-34: created from the toolbar while panned far away, the note is still on screen', async ({ page }) => {
  await openBoard(page);
  // A part of the board a million units from where the board opens.
  const far = await setCamera(page, { x: 1_000_000, y: 1_000_000 });

  await stickyButton(page).click();

  await expect.poll(() => noteCount(page)).toBe(1);
  const note = (await stickies(page))[0];
  expect(note.x).toBeCloseTo(far.x + BOARD_AREA.width / 2 - STICKY_SIZE_WORLD / 2, 1);
  expect(note.y).toBeCloseTo(far.y + BOARD_AREA.height / 2 - STICKY_SIZE_WORLD / 2, 1);
  // Visible on screen, in the middle of it, not a million units away.
  const centre = await centreOf(page);
  expectPixels(centre.x, MIDDLE.x, 'the note is in the middle of the screen');
  expectPixels(centre.y, MIDDLE.y, 'the note is in the middle of the screen');
  await page.keyboard.type('made far away');
  expect((await stickies(page))[0].text).toBe('made far away');
  // And the whole note is inside the window.
  const box = await noteBox(page);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(BOARD_AREA.width);
  expect(box.y + box.height).toBeLessThanOrEqual(BOARD_AREA.height);
});

test('the brainstorm golden path: create, type, move at 50%, recolour, delete', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, 'Hello');
  await createNote(page, { x: 900, y: 500 }, 'Stay');
  await page.keyboard.press('Escape');
  const [first, second] = await stickies(page);

  // Move the first note at 50% zoom.
  await setCamera(page, { zoom: 0.5 });
  await expect(zoomLabel(page)).toHaveText('50%');
  const moved = (await stickies(page))[0];
  const grab = await centreOf(page, 0);
  await dragNote(page, grab, DRAG_RIGHT, DRAG_DOWN);

  const afterMove = (await stickies(page)).find((note) => note.id === first.id)!;
  expect(afterMove.x - moved.x).toBeCloseTo(DRAG_RIGHT / 0.5, 1);
  expect(afterMove.y - moved.y).toBeCloseTo(DRAG_DOWN / 0.5, 1);

  // Recolour the note that was left alone, then delete the one that was moved.
  await noteAt(page, 1).click();
  await swatch(page, 'orange').click();
  await expect.poll(async () => (await stickies(page)).find((note) => note.id === second.id)?.color).toBe('orange');

  await noteAt(page, 1).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => noteCount(page)).toBe(1);

  // The board ends with the note that was moved: same id, same text, new place.
  const remaining = await stickies(page);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].id).toBe(first.id);
  expect(remaining[0].text).toBe('Hello');
  expect(remaining[0].x).toBe(afterMove.x);
  expect(remaining[0].y).toBe(afterMove.y);
  expect(remaining[0].color).toBe('yellow');
  await expect(notes(page)).toHaveCount(1);
});

test('notes are stacked in the order they were raised, and a drag raises the one under', async ({ page }) => {
  await openBoard(page);
  const first = await createNote(page, { x: 400, y: 300 }, 'bottom');
  await createNote(page, { x: 600, y: 380 }, 'middle');
  await createNote(page, { x: 800, y: 460 }, 'top');
  await page.keyboard.press('Escape');

  const three = await stickies(page);
  expect(three.map((note) => note.z)).toEqual([1, 2, 3]);

  // Drag the bottom note onto the top one: it ends up above it.
  const bottom = three[0];
  const camera = await getCamera(page);
  const grab = worldToScreen(camera, { x: bottom.x + 20, y: bottom.y + 20 });
  const target = worldToScreen(camera, { x: three[2].x + 20, y: three[2].y + 20 });
  await dragNote(page, grab, target.x - grab.x, target.y - grab.y);

  const raised = await stickies(page);
  expect(raised).toHaveLength(3);
  expect(raised[raised.length - 1].id).toBe(first);
  expect(raised[raised.length - 1].z).toBe(Math.max(...raised.map((note) => note.z)));
  // The order in the document is the order the notes are painted in.
  const painted = await paintedIds(page);
  expect(painted).toEqual(raised.map((note) => note.id));
  // The other two notes kept their places.
  for (const untouched of ['middle', 'top']) {
    const was = three.find((note) => note.text === untouched)!;
    const now = raised.find((note) => note.text === untouched)!;
    expect(now.x).toBe(was.x);
    expect(now.y).toBe(was.y);
    expect(now.z).toBe(was.z);
  }
});

test('a note is reached with Tab, edited with Enter, and Backspace belongs to the text', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, 'Tab to me');

  // Selected but not being typed into, and the focus is somewhere else: a keyboard
  // user must be able to reach the note with Tab.
  expect((await noteAppearance(page)).selected).toBe('true');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  // Twenty-five presses rather than fifteen: story 9 put two more buttons on the toolbar — Select and Text —
  // and the walk round the page got two stops longer with them. The bound is how far the test is willing to
  // walk, not anything the app promises; what it asserts is on the next line, that the note is reached.
  for (let presses = 0; presses < 25 && !reached; presses += 1) {
    await page.keyboard.press('Tab');
    reached = await noteAt(page).evaluate((element) => element === document.activeElement);
  }
  expect(reached, 'Tab reaches the note: it is in the tab order').toBe(true);
  await expect(noteAt(page)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeVisible();
  // The cursor starts at the end of the text, not in front of it.
  expect(
    await editor(page).evaluate((element) => {
      const box = element as HTMLTextAreaElement;
      return { start: box.selectionStart, end: box.selectionEnd, length: box.value.length };
    }),
  ).toEqual({ start: 'Tab to me'.length, end: 'Tab to me'.length, length: 'Tab to me'.length });

  // Backspace removes a character of the text, not the note.
  await page.keyboard.press('Backspace');
  await expect
    .poll(async () => (await stickies(page))[0].text)
    .toBe('Tab to me'.slice(0, -1));
  expect(await noteCount(page)).toBe(1);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect.poll(() => noteCount(page)).toBe(0);
});

test('nothing selected: Enter makes no note and Delete removes nothing', async ({ page }) => {
  await openBoard(page);

  await page.keyboard.press('Enter');
  expect(await noteCount(page)).toBe(0);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  expect(await noteCount(page)).toBe(0);
  // The board is still there to be used afterwards.
  await doubleClickBoard(page, CREATE_AT);
  await expect(editor(page)).toBeVisible();
  expect(await lastNoteId(page)).not.toBe('');
});

test('a press on a tool is not a board gesture: no pan, no note, no drag', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, RETRO_NOTE);
  const camera = await settled(page);
  const placed = (await stickies(page))[0];

  // Press and release on the toolbar's swatch without clicking it.
  const pink = swatch(page, 'pink');
  await pink.hover();
  await page.mouse.down();
  await page.mouse.move(400, 200, { steps: 4 });
  await page.mouse.up();

  expect(await getCamera(page)).toEqual(camera);
  expect(await noteCount(page)).toBe(1);
  expect((await stickies(page))[0].color).toBe('yellow');
  // The note did not move either: the press never reached it.
  expect((await stickies(page))[0].x).toBe(placed.x);
  expect((await stickies(page))[0].y).toBe(placed.y);
  // A real click on the same swatch does recolour it.
  await pink.click();
  await expect.poll(async () => (await stickies(page))[0].color).toBe('pink');
  expect(await getCamera(page)).toEqual(camera);
});

test('the note toolbar keeps its size on screen at every zoom and says which colour the note has', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, SHORT_NOTE);

  await expect(noteToolbar(page)).toBeVisible();
  const atOne = await boxOf(noteToolbar(page));
  await expect(swatch(page, 'yellow')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'violet')).toHaveAttribute('aria-pressed', 'false');

  await setCamera(page, { zoom: 2 });
  await expect(zoomLabel(page)).toHaveText('200%');
  const atTwo = await boxOf(noteToolbar(page));
  // The note doubled; the toolbar did not.
  expectPixels((await noteBox(page)).width, STICKY_SIZE_WORLD * 2, 'the note doubles');
  expectPixels(atTwo.width, atOne.width, 'the toolbar keeps its screen size');
  expectPixels(atTwo.height, atOne.height, 'the toolbar keeps its screen size');
  // It stays with its note, above the note's top-left corner.
  const note = (await stickies(page))[0];
  const corner = worldToScreen(await getCamera(page), { x: note.x, y: note.y });
  expectPixels(atTwo.x, corner.x, 'the toolbar starts above the note');
  expect(atTwo.y + atTwo.height).toBeLessThanOrEqual(corner.y + TOLERANCE_PX);

  await deleteButton(page).click();
  await expect.poll(() => noteCount(page)).toBe(0);
  await expect(noteToolbar(page)).toHaveCount(0);
});

test('the board pans under a note, and a note does not pan the board', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, 'Do not move me');
  const camera = await settled(page);
  const note = (await stickies(page))[0];

  // A drag that starts on the note moves the note and leaves the board alone.
  await dragNote(page, await centreOf(page), 60, 40);
  expect(await getCamera(page)).toEqual(camera);
  const dragged = (await stickies(page))[0];
  expect(dragged.x).toBeCloseTo(note.x + 60 / camera.zoom, 1);

  // A drag that starts on empty board space pans the board and carries the note with it.
  const empty = { x: 120, y: 700 };
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x - 80, empty.y - 30, { steps: 4 });
  await page.mouse.up();
  const panned = await settled(page);
  expect(panned.x).toBeCloseTo(camera.x + 80 / camera.zoom, 1);
  expect(panned.y).toBeCloseTo(camera.y + 30 / camera.zoom, 1);
  // The note is the same note in the same board place, now somewhere else on screen.
  expect((await stickies(page))[0].x).toBe(dragged.x);
  expect((await stickies(page))[0].y).toBe(dragged.y);
  const centre = await centreOf(page);
  const expected = worldToScreen(panned, { x: dragged.x + STICKY_SIZE_WORLD / 2, y: dragged.y + STICKY_SIZE_WORLD / 2 });
  expectPixels(centre.x, expected.x, 'the note is painted where the board says');
});

test('two notes made one after the other are two notes, apart, the second one being typed into', async ({ page }) => {
  await openBoard(page);

  await doubleClickBoard(page, CREATE_AT);
  await page.keyboard.type('first');
  await page.keyboard.press('Escape');
  await doubleClickBoard(page, { x: 900, y: 500 });
  await page.keyboard.type('second');

  const both = await stickies(page);
  expect(both).toHaveLength(2);
  expect(both.map((note) => note.text)).toEqual(['first', 'second']);
  // They are not on top of each other by accident.
  expect(Math.hypot(both[1].x - both[0].x, both[1].y - both[0].y)).toBeGreaterThan(STICKY_SIZE_WORLD);
  // The one being typed into is the newest, and it is on top.
  expect(await lastNoteId(page)).toBe(both[1].id);
  expect((await noteAppearance(page, 1)).selected).toBe('true');
  expect((await noteAppearance(page, 0)).selected).toBe('false');
});

test('everything written survives a zoom out to a quarter and back to full size', async ({ page }) => {
  await openBoard(page);
  await createNote(page, CREATE_AT, LONG_NOTE.slice(0, 120));
  await createNote(page, { x: 900, y: 200 }, 'second note');
  const before = await stickies(page);

  await setCamera(page, { zoom: 0.25 });
  expect(await zoomLabel(page)).toHaveText('25%');
  await setCamera(page, { zoom: 4 });
  await setCamera(page, { zoom: 1 });

  expect(await stickies(page)).toEqual(before);
  expectPixels((await noteBox(page, 0)).width, STICKY_SIZE_WORLD, 'the note is its own size again at 100%');
  expectPixels((await noteBox(page, 1)).width, STICKY_SIZE_WORLD, 'and so is the other one');
});
