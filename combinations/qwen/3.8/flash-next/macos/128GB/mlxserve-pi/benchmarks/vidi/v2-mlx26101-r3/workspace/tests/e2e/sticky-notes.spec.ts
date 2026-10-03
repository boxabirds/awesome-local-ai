import { expect, test } from '@playwright/test';
import { LONG_PROSE, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { openBoard, readCamera, setCamera, settle, VIEWPORT, zoomText } from './helpers/board';
import {
  boxOf,
  cameraAround,
  caretAt,
  centreByIdOnScreen,
  centreNoteById,
  colourSwatch,
  createStickyButton,
  deleteNoteButton,
  doubleClickBoard,
  dragPointer,
  editor,
  fadeAt,
  noteAt,
  noteBackground,
  noteById,
  noteCentreOnScreen,
  noteCounter,
  noteFontSize,
  noteId,
  noteIds,
  noteSizeOnScreen,
  noteState,
  notes,
  originOnScreen,
  pasteIntoNote,
  PX,
  setColour,
  stateById,
  stopEditing,
  textAt,
  textById,
  textOverflow,
  toolbarAt,
  toolbarById,
  topNoteId,
  typeInNote,
  unchanged,
  waitForNote,
} from './helpers/sticky';

/**
 * Story 2 in a real browser: notes are created by double-clicking, hold the text typed into
 * them, are dragged around at any zoom, recoloured and deleted.
 *
 * Text layout is real here, which is what makes the auto-fit worth measuring at all (jsdom
 * lays nothing out), and the pointer is real, which is what makes "the point you grabbed
 * stays under the pointer" a claim rather than a restatement of the maths.
 *
 * One thing to keep in mind while reading: the notes are drawn in stacking order, so a note
 * that is brought to the front moves to the end of the DOM. Anything that happens around a
 * drag looks notes up by their id.
 */

/** Somewhere in the middle of an empty board, away from the toolbars at the edges. */
const OPEN_SPACE = { x: 400, y: 300 };

const PINK_PAINT = 'rgb(244, 143, 177)';

test.describe('sticky notes: creating one and typing into it', () => {
  test('TC-30: double-click empty board space, type, and the note is there with the text', async ({
    page,
  }) => {
    await openBoard(page);
    const camera = await readCamera(page);

    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Hello');

    await expect(editor(page)).toHaveValue('Hello');
    // The note is centred on the point that was double-clicked, within a pixel.
    const centre = await noteCentreOnScreen(page, 0);
    expect(Math.abs(centre.x - OPEN_SPACE.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(centre.y - OPEN_SPACE.y)).toBeLessThanOrEqual(PX);
    // What is stored is that point minus half the note, yellow, and on top of everything.
    const world = screenToWorld(camera, OPEN_SPACE);
    const note = await noteState(page, 0);
    expect(note.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 3);
    expect(note.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 3);
    expect(note.color).toBe('yellow');
    expect(note.selected).toBe(true);
    expect(note.z).toBe(1);
    // At 100% zoom the note is STICKY_SIZE_WORLD across on screen.
    const size = await noteSizeOnScreen(page, 0);
    expect(size.width).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 0);
    expect(size.height).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 0);

    // Escape stops editing without losing anything, and leaves the note selected.
    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText('Hello');
    expect((await noteState(page, 0)).selected).toBe(true);
  });

  test('TC-35: double-clicking a note edits it instead of adding another', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'First');
    await stopEditing(page);

    const centre = await noteCentreOnScreen(page, 0);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('First');
    // The caret is at the end of the text that was already there.
    expect(await caretAt(page)).toBe('First'.length);

    // A space typed into the note belongs to the text: it is not eaten by the note.
    await typeInNote(page, ' idea');
    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText('First idea');
    await expect(notes(page)).toHaveCount(1);
  });

  test('TC-25, TC-26: Enter edits the selected note; the delete keys edit text, not notes', async ({
    page,
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Temple');
    await stopEditing(page);

    // Select it again with a single click, then edit from the keyboard.
    const centre = await noteCentreOnScreen(page, 0);
    await page.mouse.click(centre.x, centre.y);
    await settle(page);
    expect((await noteState(page, 0)).selected).toBe(true);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();

    // While typing, Backspace and Delete take characters off the text; the note stays.
    await page.keyboard.press('Backspace');
    await settle(page);
    await expect(editor(page)).toHaveValue('Templ');
    await page.keyboard.press('Delete');
    await settle(page);
    await expect(editor(page)).toHaveValue('Templ');
    await expect(notes(page)).toHaveCount(1);

    // Out of the text again, and the same keys delete the note.
    await stopEditing(page);
    await page.keyboard.press('Delete');
    await settle(page);
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-36: Enter with nothing selected creates and edits nothing', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await settle(page);

    await expect(notes(page)).toHaveCount(0);
    expect(await editor(page).count()).toBe(0);
    // The board is still there and still responds.
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Now');
    await expect(editor(page)).toHaveValue('Now');
  });
});

test.describe('sticky notes: moving, recolouring and deleting', () => {
  test('workflow: from an idea to a moved, recoloured, deleted note', async ({ page }) => {
    await openBoard(page);

    // 1. An idea, typed straight onto the board (TC-30).
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Move me');
    const typed = await noteCentreOnScreen(page, 0);
    expect(Math.abs(typed.x - OPEN_SPACE.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(typed.y - OPEN_SPACE.y)).toBeLessThanOrEqual(PX);
    const movedId = await noteId(page, 0);
    await stopEditing(page);

    // 2. A second idea, so that "which notes are left" means something.
    await doubleClickBoard(page, { x: 900, y: 620 });
    await typeInNote(page, 'Keep');
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(2);
    const keptId = await noteId(page, 1);
    const kept = await stateById(page, keptId);

    // 3. Zoom out to 50% and move the first idea by 100 x 50 screen pixels (TC-31).
    const camera = await centreNoteById(page, movedId, 0.5);
    expect(await zoomText(page)).toBe('50%');
    const before = await stateById(page, movedId);
    const centre = await centreByIdOnScreen(page, movedId);
    // Grab the note 20 x 15 pixels away from its centre, and pull by (100, 50).
    const grabbed = { x: centre.x - 20, y: centre.y - 15 };
    const finish = { x: grabbed.x + 100, y: grabbed.y + 50 };
    // The world point under the pointer when it went down, relative to the note's top-left.
    const hold = screenToWorld(camera, grabbed);
    const offset = { x: hold.x - before.x, y: hold.y - before.y };

    await dragPointer(page, grabbed, finish);

    // 100 x 50 on screen at half zoom is 200 x 100 in world units.
    const after = await stateById(page, movedId);
    expect(after.x).toBeCloseTo(before.x + 100 / camera.zoom, 2);
    expect(after.y).toBeCloseTo(before.y + 50 / camera.zoom, 2);
    // The point that was grabbed is still under the pointer, within a pixel.
    const underPointer = {
      x: (after.x + offset.x - camera.x) * camera.zoom,
      y: (after.y + offset.y - camera.y) * camera.zoom,
    };
    expect(Math.abs(underPointer.x - finish.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(underPointer.y - finish.y)).toBeLessThanOrEqual(PX);
    // Dragging a note never pans the board and never moves the other note.
    expect(await readCamera(page)).toEqual(camera);
    expect(unchanged(await stateById(page, keptId))).toEqual(unchanged(kept));
    await expect(textById(page, movedId)).toHaveText('Move me');

    // 4. A different colour, from the toolbar above the selected note (TC-27). The moved
    // note is the last one in the document now, which is what "on top" means here.
    await expect(toolbarById(page, movedId)).toBeVisible();
    await setColour(page, movedId, 'pink');
    expect(await noteBackground(noteById(page, movedId))).toBe(PINK_PAINT);
    const recoloured = await stateById(page, movedId);
    // Only the colour changed: same place, same stack order, same text.
    expect(recoloured.x).toBe(after.x);
    expect(recoloured.y).toBe(after.y);
    expect(recoloured.z).toBe(after.z);
    await expect(textById(page, movedId)).toHaveText('Move me');

    // 5. Delete it from the keyboard (TC-25): the other idea stays on the board.
    await page.keyboard.press('Delete');
    await settle(page);
    await expect(notes(page)).toHaveCount(1);
    expect(await noteIds(page)).toEqual([keptId]);
    await expect(textAt(page, 0)).toHaveText('Keep');
    expect((await noteState(page, 0)).color).toBe('yellow');
    expect(await colourSwatch(page, 'pink').count()).toBe(0);

    // 6. The last one goes by its toolbar's delete button (TC-29), so it has to be the one
    // that is selected first.
    const survivor = await noteCentreOnScreen(page, 0);
    await page.mouse.click(survivor.x, survivor.y);
    await expect(toolbarById(page, keptId)).toBeVisible();
    await deleteNoteButton(page).click();
    await settle(page);
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-31: at 50% zoom a 100 x 50 drag is 200 x 100 world units, and the board does not pan', async ({
    page,
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, { x: 640, y: 400 });
    await typeInNote(page, 'Half');
    await stopEditing(page);
    const id = await noteId(page, 0);

    const camera = await centreNoteById(page, id, 0.5);
    const before = await stateById(page, id);
    const centre = await centreByIdOnScreen(page, id);
    // At this zoom the note is 100 pixels across, so these points are inside it.
    const grabbed = { x: centre.x - 30, y: centre.y - 20 };
    const finish = { x: grabbed.x + 100, y: grabbed.y + 50 };

    await dragPointer(page, grabbed, finish);

    const after = await stateById(page, id);
    expect(after.x).toBeCloseTo(before.x + 100 / camera.zoom, 2);
    expect(after.y).toBeCloseTo(before.y + 50 / camera.zoom, 2);
    expect(await readCamera(page)).toEqual(camera);
    expect((await centreByIdOnScreen(page, id)).x).toBeCloseTo(centre.x + 100, 0);
    const size = await noteSizeOnScreen(page, 0);
    expect(size.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);
  });

  test('TC-32: at 200% zoom a 100 x 50 drag is 50 x 25 world units, and the note comes to the front', async ({
    page,
  }) => {
    await openBoard(page);
    // At 200% a note is 400 pixels across, so these two notes overlap heavily. The second
    // one is opened where the first is not drawn, or it would be editing that note instead
    // of adding one.
    await setCamera(page, cameraAround({ x: 0, y: 0 }, 2));
    expect(await zoomText(page)).toBe('200%');

    await doubleClickBoard(page, { x: 400, y: 300 });
    await typeInNote(page, 'A');
    await stopEditing(page);
    const first = await noteState(page, 0);
    const firstId = await noteId(page, 0);

    await doubleClickBoard(page, { x: 650, y: 450 });
    await typeInNote(page, 'B');
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(2);
    const second = await noteState(page, 1);
    const secondId = await noteId(page, 1);

    const overlap = { x: 520, y: 380 };
    // The newer note is drawn over the older one where they overlap.
    expect(await topNoteId(page, overlap)).toBe(secondId);
    // Grab note A where only A reaches.
    const grabbed = { x: 300, y: 350 };
    expect(await topNoteId(page, grabbed)).toBe(firstId);
    const camera = await readCamera(page);

    await dragPointer(page, grabbed, { x: grabbed.x + 100, y: grabbed.y + 50 });

    const after = await stateById(page, firstId);
    expect(after.x).toBeCloseTo(first.x + 100 / camera.zoom, 2);
    expect(after.y).toBeCloseTo(first.y + 50 / camera.zoom, 2);
    // It was on top before the drag and it is on top after it, and the note underneath was
    // left alone.
    expect(after.z).toBeGreaterThan(second.z);
    expect(await topNoteId(page, overlap)).toBe(firstId);
    expect(unchanged(await stateById(page, secondId))).toEqual(unchanged(second));
    expect(await readCamera(page)).toEqual(camera);
  });

  test('TC-32b: a note dragged onto another is drawn above it afterwards', async ({ page }) => {
    await openBoard(page);

    await doubleClickBoard(page, { x: 400, y: 300 });
    await typeInNote(page, 'one');
    await stopEditing(page);
    const firstId = await noteId(page, 0);

    await doubleClickBoard(page, { x: 560, y: 420 });
    await typeInNote(page, 'two');
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(2);
    const secondId = await noteId(page, 1);
    const second = await stateById(page, secondId);
    expect((await stateById(page, firstId)).z).toBeLessThan(second.z);

    // Where the first note is going to land, the second one is on top for now.
    const landing = { x: 580, y: 430 };
    expect(await topNoteId(page, landing)).toBe(secondId);
    const camera = await readCamera(page);

    // Drag the first note the whole way onto the second.
    await dragPointer(page, { x: 400, y: 300 }, landing);

    expect((await stateById(page, firstId)).z).toBeGreaterThan(second.z);
    expect(await topNoteId(page, landing)).toBe(firstId);
    // Notes are drawn in document order, so the one on top is also last in the DOM.
    expect(await noteIds(page)).toEqual([secondId, firstId]);
    // The other note is where it was, and so is the board.
    expect(unchanged(await stateById(page, secondId))).toEqual(unchanged(second));
    expect(await readCamera(page)).toEqual(camera);
  });

  test('TC-19: two pixels of movement is a click, not a drag', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Still');
    await stopEditing(page);

    const before = await noteState(page, 0);
    const centre = await noteCentreOnScreen(page, 0);
    await dragPointer(page, centre, { x: centre.x + 2, y: centre.y + 2 }, 2);

    const after = await noteState(page, 0);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // It is a click, so the note is selected and its toolbar is up.
    expect(after.selected).toBe(true);
    await expect(toolbarAt(page, 0)).toBeVisible();
  });

  test('TC-22: a click on empty board space deselects the note and hides its toolbar', async ({
    page,
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Alone');
    await stopEditing(page);
    await expect(toolbarAt(page, 0)).toBeVisible();

    await page.mouse.click(1_100, 120);
    await settle(page);

    expect((await noteState(page, 0)).selected).toBe(false);
    expect(await toolbarAt(page, 0).count()).toBe(0);
    expect(await noteAt(page, 0).getAttribute('data-selected')).toBe('false');
  });
});

test.describe('sticky notes: text that fits the note', () => {
  test('TC-33: a word is drawn big, a full note is drawn small and faded inside its box', async ({
    page,
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);

    // A single word gets the largest size in the allowed range.
    await typeInNote(page, 'Idea');
    expect(await noteFontSize(noteAt(page, 0), page)).toBe(STICKY_FONT_MAX_PX);
    expect(await noteCounter(page).count()).toBe(0);
    expect(await fadeAt(page, 0).count()).toBe(0);

    // A full note of English: smaller, but never smaller than the floor, and what does not
    // fit is clipped inside the note with a fade along its bottom edge.
    await pasteIntoNote(page, LONG_PROSE);
    const font = await noteFontSize(noteAt(page, 0), page);
    expect(font).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(font).toBeLessThan(STICKY_FONT_MAX_PX);
    await expect(noteCounter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
    await expect(fadeAt(page, 0)).toBeVisible();
    // There really is more text than the note can show.
    expect(await textOverflow(noteAt(page, 0), page)).toBe(true);

    // Nothing of the note is drawn outside the note: it never grows, and the fade is inside.
    const box = await boxOf(noteAt(page, 0));
    const fade = await boxOf(fadeAt(page, 0));
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
    expect(box.height).toBeCloseTo(STICKY_SIZE_WORLD, 0);
    expect(fade.x + fade.width).toBeLessThanOrEqual(box.x + box.width + PX);
    expect(fade.y + fade.height).toBeLessThanOrEqual(box.y + box.height + PX);

    // The same text is still there once editing stops, still fitted and still clipped.
    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText(LONG_PROSE);
    expect(await noteFontSize(noteAt(page, 0), page)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    await expect(fadeAt(page, 0)).toBeVisible();
    expect(
      await noteAt(page, 0).evaluate((element) =>
        getComputedStyle(element.querySelector('.sticky-note__clip') as Element).overflow,
      ),
    ).toBe('hidden');
    const shown = await noteAt(page, 0).evaluate((element) => {
      const clip = element.querySelector('.sticky-note__clip') as HTMLElement;
      return { cutOff: clip.scrollHeight > clip.clientHeight, painted: clip.children.length };
    });
    expect(shown.cutOff).toBe(true);
    // Only the text and the fade are drawn inside the note: nothing is added off-screen.
    expect(shown.painted).toBe(2);
  });

  test('TC-33b: a short phrase stays at the largest size and needs no fade', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await pasteIntoNote(page, SHORT_PHRASE);
    expect(await noteFontSize(noteAt(page, 0), page)).toBe(STICKY_FONT_MAX_PX);
    expect(await noteCounter(page).count()).toBe(0);
    expect(await fadeAt(page, 0).count()).toBe(0);

    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText(SHORT_PHRASE);
    expect(await noteFontSize(noteAt(page, 0), page)).toBe(STICKY_FONT_MAX_PX);
    expect(await fadeAt(page, 0).count()).toBe(0);
  });

  test('TC-33c: three lines are laid out inside the note, at a size in range', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await pasteIntoNote(page, RETRO_ITEM);
    await expect(editor(page)).toHaveValue(RETRO_ITEM);
    const font = await noteFontSize(noteAt(page, 0), page);
    expect(font).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(font).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);

    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText(RETRO_ITEM);
    // The three lines are drawn one below the other, inside the note.
    const lines = await textAt(page, 0).evaluate((element) => {
      const selection = document.createRange();
      selection.selectNodeContents(element);
      const tops = [...selection.getClientRects()]
        .map((rect) => Math.round(rect.y))
        .filter((top, index, all) => all.indexOf(top) === index);
      return tops.length;
    });
    expect(lines).toBeGreaterThanOrEqual(3);
    const note = await boxOf(noteAt(page, 0));
    const text = await boxOf(textAt(page, 0));
    expect(text.x).toBeGreaterThanOrEqual(note.x - PX);
    expect(text.x + text.width).toBeLessThanOrEqual(note.x + note.width + PX);
  });

  test('TC-14: nothing is kept beyond a thousand characters', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await pasteIntoNote(page, LONG_PROSE);
    await typeInNote(page, 'x');

    await expect(editor(page)).toHaveValue(LONG_PROSE);
    expect(await caretAt(page)).toBe(STICKY_TEXT_MAX_CHARS);
    await expect(noteCounter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText(LONG_PROSE);
  });

  test('TC-24: Escape keeps the text and the selection', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Escaped');

    await stopEditing(page);

    expect(await editor(page).count()).toBe(0);
    await expect(textAt(page, 0)).toHaveText('Escaped');
    expect((await noteState(page, 0)).selected).toBe(true);
    await expect(toolbarAt(page, 0)).toBeVisible();
  });

  test('TC-38: a click outside the note keeps the text and deselects', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'Outside');

    await page.mouse.click(1_000, 600);
    await settle(page);

    expect(await editor(page).count()).toBe(0);
    await expect(textAt(page, 0)).toHaveText('Outside');
    expect((await noteState(page, 0)).selected).toBe(false);
    expect(await toolbarAt(page, 0).count()).toBe(0);
  });
});

test.describe('sticky notes: a note appears where the board currently is', () => {
  test('TC-34: after panning far away, the Sticky note button puts a note in the middle of the view', async ({
    page,
  }) => {
    await openBoard(page);
    const far = { x: -12_345, y: 6_789, zoom: 1 };
    await setCamera(page, far);
    // The world origin is long gone off the screen: we really are far away.
    const origin = await originOnScreen(page);
    expect(Math.abs(origin.x - VIEWPORT.width / 2)).toBeGreaterThan(1_000);

    await createStickyButton(page).click();
    await settle(page);
    const note = await waitForNote(page, 0);

    const centre = await noteCentreOnScreen(page, 0);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(PX);
    // In world units it sits at the far-away point, not at the middle of the world.
    const world = screenToWorld(far, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(note.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 3);
    expect(note.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 3);
    // Ready for typing, without another click.
    await expect(editor(page)).toBeFocused();
    await typeInNote(page, 'Here');
    await stopEditing(page);
    await expect(textAt(page, 0)).toHaveText('Here');
  });

  test('TC-34b: notes added twice from the button are stacked, the newer one on top', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: -3_000, y: -2_000, zoom: 2 });

    await createStickyButton(page).click();
    await stopEditing(page);
    await createStickyButton(page).click();
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(2);

    const first = await noteState(page, 0);
    const second = await noteState(page, 1);
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
    expect(second.z).toBeGreaterThan(first.z);
    const centre = await noteCentreOnScreen(page, 1);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);
    expect(await topNoteId(page, centre)).toBe(await noteId(page, 1));
  });

  test('TC-34c: a note created at 50% zoom is drawn at half size, and its toolbar keeps its size', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, cameraAround({ x: 0, y: 0 }, 0.5));

    await createStickyButton(page).click();
    await typeInNote(page, 'Small');
    await stopEditing(page);

    const size = await noteSizeOnScreen(page, 0);
    expect(size.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);
    await expect(textAt(page, 0)).toHaveText('Small');
    const toolbar = await boxOf(toolbarAt(page, 0));
    // The toolbar is drawn in screen space: a usable size at any zoom.
    expect(toolbar.height).toBeGreaterThan(10);
    expect(toolbar.height).toBeLessThan(60);
  });

  test('TC-28: the Sticky note button works with a note already on the board', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, OPEN_SPACE);
    await typeInNote(page, 'One');
    await stopEditing(page);
    const firstId = await noteId(page, 0);

    await createStickyButton(page).click();
    await typeInNote(page, 'Two');
    await stopEditing(page);

    await expect(notes(page)).toHaveCount(2);
    const centre = await noteCentreOnScreen(page, 1);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(PX);
    await expect(textAt(page, 1)).toHaveText('Two');
    // The first note was left alone, and the new one is on top of it.
    await expect(textById(page, firstId)).toHaveText('One');
    expect(await topNoteId(page, centre)).toBe(await noteId(page, 1));
  });
});

