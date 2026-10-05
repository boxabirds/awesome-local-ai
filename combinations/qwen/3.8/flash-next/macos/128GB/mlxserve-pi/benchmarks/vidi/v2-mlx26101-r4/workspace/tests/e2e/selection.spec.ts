/**
 * e2e tests for selecting, moving, resizing and deleting several objects at once (story 7,
 * TC-32 to TC-36).
 *
 * These check what a jsdom test cannot: that a box drawn with the mouse really chooses the note lying
 * inside it and leaves the one that sticks out (which depends on where the note is actually painted,
 * not on where a test believes it is), that arrow keys move notes without scrolling the page, that a
 * person's selection survives somebody else deleting one of the notes in it, and that as many people as
 * the board is designed for can each move their own selection at the same time and still end up looking
 * at the same board.
 *
 * The camera is left where the board puts it — framed on its own centre at zoom 1 — so screen pixels
 * and board units are the same size and a drag of 300 pixels is a move of 300 units. Notes are found by
 * id rather than by position in a list throughout, because the order they are painted in is the order
 * they are stacked in, and this story changes the stacking.
 */
import { expect, test, type Page } from '@playwright/test';

import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { BOARD_AREA, getCamera, openBoard, settled, setCamera, TOLERANCE_PX } from './helpers/board';
import type { Point } from './helpers/board';
import {
  createNote,
  dragNote,
  editor,
  noteAt,
  noteBox,
  noteCount,
  paintedIds,
  stickies,
} from './helpers/sticky';
import {
  CAPACITY,
  closeParticipants,
  dragNoteById,
  editNoteById,
  expectConverged,
  expectEventually,
  logLatencies,
  measurements,
  openParticipants,
  selectNoteById,
} from './helpers/participants';

/** The number of notes a board is drawn for in these tests, which is also its editor capacity. */
const MIDDLE = { x: BOARD_AREA.width / 2, y: BOARD_AREA.height / 2 };

/**
 * The ids this page has chosen, in the order the notes are painted.
 *
 * Read from what is drawn rather than from what the app believes its selection to be, because what a
 * person can act on is what is drawn: an outline left on a note that is not there is a fault even when
 * the state behind it is right.
 */
async function selectedIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-note-id]')]
      .filter((element) => (element as HTMLElement).dataset.selected === 'true')
      .map((element) => (element as HTMLElement).dataset.noteId ?? ''),
  );
  return ids;
}

/** What this page says is selected, in words, or null when it says nothing. */
async function selectionWords(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('[data-testid="selection-count"]')?.textContent ?? null);
}

/** How many resize handles this page is showing. */
async function handles(page: Page): Promise<number> {
  return page.locator('[data-testid^="resize-handle-"]').count();
}

/** How many outlines this page is drawing. */
async function outlines(page: Page): Promise<number> {
  return page.locator('[data-testid="selection-outline"]').count();
}

/** The rectangle being drawn while the pointer is dragged across empty board space, or null. */
async function marqueeBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="marquee"]') as HTMLElement | null;
    if (!element) return null;
    return {
      x: Number.parseFloat(element.style.left),
      y: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    };
  });
}

/**
 * Put a note down and return its id.
 *
 * The id is found by asking the board what it held before and after, because the board reports its
 * notes in stacking order: the note made last is the one last written, but not necessarily the last one
 * in the list, and a test that assumed so would be checking a note against the wrong numbers.
 */
async function makeNote(page: Page, at: Point, text = ''): Promise<string> {
  const before = new Set((await stickies(page)).map((note) => note.id));
  await createNote(page, at, text);
  const added = (await stickies(page)).filter((note) => !before.has(note.id));
  if (added.length !== 1) throw new Error(`a double-click should have made one note, made ${added.length}`);
  return added[0].id;
}

/**
 * Drag the mouse across the board with Shift held, and let go.
 *
 * Shift stays down for the whole gesture, as it does for a person: down before the press, up after the
 * release. Releasing it in the middle would hand the last part of the drag back to the pan.
 */
async function dragBox(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(Math.round((from.x + to.x) / 2), Math.round((from.y + to.y) / 2), { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settled(page);
}

/** Press a key on the page itself, with nothing being typed in. */
async function press(page: Page, key: string, modifier: 'shift' | 'ctrl' | null = null): Promise<void> {
  if (modifier !== null) await page.keyboard.down(modifier === 'ctrl' ? 'Control' : 'Shift');
  await page.keyboard.press(key);
  if (modifier !== null) await page.keyboard.up(modifier === 'ctrl' ? 'Control' : 'Shift');
  await settled(page);
}

/** Where a note is in this page's document, in board units — position and size, nothing else. */
async function place(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number; z: number }> {
  const note = (await stickies(page)).find((object) => object.id === id);
  if (!note) throw new Error(`this page's board holds no note with id ${id}`);
  return { x: note.x, y: note.y, width: note.width, height: note.height, z: note.z };
}

/** Read something for each id, in order, and hand back the pairs. */
async function mapAll<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T>,
): Promise<[string, T][]> {
  const pairs: [string, T][] = [];
  for (const id of ids) pairs.push([id, await read(id)]);
  return pairs;
}

/** Move the mouse onto a note's centre. */
async function pointOf(page: Page, id: string): Promise<Point> {
  const index = await paintedIds(page).then((ids) => ids.indexOf(id));
  if (index < 0) throw new Error(`this page paints no note with id ${id}`);
  const box = await noteBox(page, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('choosing a region of the board', () => {
  test('TC-32: a box chooses the note inside it, and leaves the one that sticks out', async ({ page }) => {
    await openBoard(page);
    const inside = await makeNote(page, { x: 250, y: 200 }, 'inside');
    const halfIn = await makeNote(page, { x: 500, y: 200 }, 'half');
    const outside = await makeNote(page, { x: 950, y: 200 }, 'outside');
    await press(page, 'Escape');
    expect(await selectedIds(page)).toEqual([]);

    // The box runs from (100, 60) to (450, 340). The first note is painted from 150 to 350 and lies
    // wholly inside it; the second is painted from 400 to 600, so the right edge of the box cuts through
    // it; the third is nowhere near. Choosing by "touches the box" would take two of the three, and the
    // one it took by mistake would move when nobody meant to move it.
    await dragBox(page, { x: 100, y: 60 }, { x: 450, y: 340 });

    expect(await selectedIds(page)).toEqual([inside]);
    expect(await outlines(page)).toBe(1);
    // One note chosen is not a group: the note's own tools appear, and the bar for several does not.
    expect(await selectionWords(page)).toBeNull();
    expect(await page.locator('[data-testid="note-toolbar"]').count()).toBe(1);
    expect(await noteCount(page)).toBe(3);

    // Adding the other two, one at a time, with the keyboard rather than the mouse.
    await press(page, 'a', 'ctrl');
    expect(await selectedIds(page)).toHaveLength(3);
    expect(await selectionWords(page)).toBe('3 selected');
    expect(await handles(page)).toBe(8);

    // And the box takes the selection back to one, because everything it covers is already chosen and
    // the note that sticks out is not.
    await press(page, 'Escape');
    await dragBox(page, { x: 100, y: 60 }, { x: 450, y: 340 });
    expect(await selectedIds(page)).toEqual([inside]);
    expect(halfIn).not.toBe(outside);
  });

  test('TC-32b: the rectangle follows the pointer, is translucent, and does not move the board', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await makeNote(page, { x: 250, y: 200 });
    await press(page, 'Escape');
    const cameraWas = await getCamera(page);

    await page.keyboard.down('Shift');
    await page.mouse.move(100, 60);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 4 });
    await page.mouse.move(450, 340, { steps: 4 });

    // While the pointer is down the rectangle is on the screen, sized by the drag rather than by the
    // notes: it is a place being pointed at, drawn at whatever size the board happens to be.
    const drawn = await marqueeBox(page);
    expect(drawn).not.toBeNull();
    expect(drawn!.x).toBeCloseTo(100, TOLERANCE_PX);
    expect(drawn!.y).toBeCloseTo(60, TOLERANCE_PX);
    expect(drawn!.width).toBeCloseTo(350, TOLERANCE_PX);
    expect(drawn!.height).toBeCloseTo(280, TOLERANCE_PX);

    const painted = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="marquee"]');
      const style = getComputedStyle(element as Element);
      return { fill: style.backgroundColor, events: style.pointerEvents, border: style.borderStyle };
    });
    // Light blue and translucent, so the notes being chosen stay visible underneath it: a person has to
    // be able to see whether the box has the right things in it before they let go. The see-through part
    // is the fill rather than the whole element, because the border is meant to stay crisp.
    const channels = painted.fill.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(channels.length).toBeGreaterThanOrEqual(4);
    const alpha = channels[3] ?? 1;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
    // Blue, which is the colour the board uses to mean "this is chosen", and not any colour at all.
    expect(channels[2]!).toBeGreaterThan(channels[0]!);
    expect(channels[2]!).toBeGreaterThan(channels[1]!);
    expect(painted.events).toBe('none');
    expect(painted.border).toBe('solid');
    // The board itself did not move: the modifier took this drag away from the pan.
    expect(await getCamera(page)).toEqual(cameraWas);

    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settled(page);
    expect(await marqueeBox(page)).toBeNull();
    expect(await selectedIds(page)).toEqual([id]);
  });

  test('TC-32c: a box drawn over nothing leaves the choice as it was, and Escape gives up the box', async ({
    page,
  }) => {
    await openBoard(page);
    const kept = await makeNote(page, { x: 250, y: 200 });
    const second = await makeNote(page, { x: 950, y: 600 });
    await press(page, 'Escape');

    // A box over the empty middle of the board chooses nothing, and choosing nothing does not empty what
    // was already chosen — the rectangle adds, and here it has nothing to add.
    await press(page, 'a', 'ctrl');
    expect(await selectedIds(page)).toHaveLength(2);
    await dragBox(page, { x: 500, y: 350 }, { x: 700, y: 480 });
    expect(await selectedIds(page)).toHaveLength(2);

    // Escape while a box is in flight gives the box up, and leaves the choice alone: the same key with
    // no box in flight empties the selection, and a box is not a selection to empty.
    await press(page, 'Escape');
    await press(page, 'a', 'ctrl');
    await page.keyboard.down('Shift');
    await page.mouse.move(400, 350);
    await page.mouse.down();
    await page.mouse.move(1100, 700, { steps: 6 });
    expect(await marqueeBox(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settled(page);

    expect(await marqueeBox(page)).toBeNull();
    expect((await selectedIds(page)).sort()).toEqual([kept, second].sort());
    expect(await noteCount(page)).toBe(2);
  });
});

test.describe('moving and resizing a selection', () => {
  test('TC-33: six notes move together, come forward above the one left out, and resize as a group', async ({
    page,
  }) => {
    await openBoard(page);
    const grid = [
      { x: 250, y: 200 },
      { x: 600, y: 200 },
      { x: 950, y: 200 },
      { x: 250, y: 550 },
      { x: 600, y: 550 },
      { x: 950, y: 550 },
    ];
    const chosen: string[] = [];
    for (const at of grid) chosen.push(await makeNote(page, at));
    const leftOut = await makeNote(page, { x: 250, y: 760 }, 'left out');

    // Choose the six with a box, so the selection is one action rather than six.
    await press(page, 'Escape');
    await dragBox(page, { x: 100, y: 60 }, { x: 1160, y: 700 });
    expect((await selectedIds(page)).sort()).toEqual([...chosen].sort());
    expect(await handles(page)).toBe(8);

    const before = new Map((await stickies(page)).map((note) => [note.id, note]));
    const wasLeftOut = await place(page, leftOut);
    const orderWas = await paintedIds(page);

    // Pick up the note that was chosen last and move it 300 units right, 100 down.
    const grab = await pointOf(page, chosen[5]!);
    await dragNote(page, grab, 300, 100);

    const after = await stickies(page);
    for (const id of chosen) {
      const was = before.get(id)!;
      const now = after.find((note) => note.id === id)!;
      expect(now.x).toBeCloseTo(was.x + 300, 1);
      expect(now.y).toBeCloseTo(was.y + 100, 1);
    }
    // The distances inside the selection are the ones they were: six notes moved by six different
    // amounts are six notes in a new arrangement, which is the one thing a group move must not do.
    expect(
      (after.find((n) => n.id === chosen[1]!)!.x - after.find((n) => n.id === chosen[0]!)!.x).toFixed(1),
    ).toBe((before.get(chosen[1]!)!.x - before.get(chosen[0]!)!.x).toFixed(1));

    // The note that was left out stayed exactly where it was, and the whole selection is now above it —
    // it came forward as one thing, keeping the order it already had among itself.
    expect(await place(page, leftOut)).toEqual(wasLeftOut);
    const raised = await paintedIds(page);
    for (const id of chosen) expect(raised.indexOf(id)).toBeGreaterThan(raised.indexOf(leftOut));
    expect(raised.indexOf(chosen[5]!)).toBe(raised.length - 1);
    expect(orderWas.length).toBe(raised.length);

    // Now resize the whole selection by its bottom-right handle. The spaces between the notes grow by
    // the same factor as the notes do, which is the difference between scaling a picture and shuffling
    // its contents about inside a frame.
    const boxBefore = new Map((await stickies(page)).map((note) => [note.id, note]));
    const gapsBefore = {
      x: boxBefore.get(chosen[1]!)!.x - boxBefore.get(chosen[0]!)!.x,
      y: boxBefore.get(chosen[3]!)!.y - boxBefore.get(chosen[0]!)!.y,
    };

    // A move of 300 units has pushed the right-hand column off the screen, and a handle that is not on
    // the screen cannot be pressed — by a test or by anybody — so the board is zoomed out first, which is
    // what a person does in the same position. The zoom is this page's own business and changes nothing
    // about the document.
    await setCamera(page, { zoom: 0.5 });
    const handle = await page.locator('[data-testid="resize-handle-se"]').boundingBox();
    expect(handle).not.toBeNull();
    const handlePoint = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
    expect(handlePoint.x).toBeLessThan(BOARD_AREA.width);
    expect(handlePoint.y).toBeLessThan(BOARD_AREA.height);
    // Half screen pixels are board units here, so this is a drag of 300 units in each direction.
    await dragNote(page, handlePoint, 150, 150);

    const grown = await stickies(page);
    const gapsAfter = {
      x: grown.find((n) => n.id === chosen[1]!)!.x - grown.find((n) => n.id === chosen[0]!)!.x,
      y: grown.find((n) => n.id === chosen[3]!)!.y - grown.find((n) => n.id === chosen[0]!)!.y,
    };
    expect(gapsAfter.x).toBeGreaterThan(gapsBefore.x);
    expect(gapsAfter.y).toBeGreaterThan(gapsBefore.y);
    const factor = grown.find((n) => n.id === chosen[0]!)!.width / boxBefore.get(chosen[0]!)!.width;
    expect(factor).toBeGreaterThan(1);
    expect(gapsAfter.x / gapsBefore.x).toBeCloseTo(factor, 1);
    expect(gapsAfter.y / gapsBefore.y).toBeCloseTo(factor, 1);
    for (const id of chosen) {
      const now = await place(page, id);
      // Sticky notes are square and stay square, whatever the pointer does on the way.
      expect(now.width).toBeCloseTo(now.height, 1);
      expect(now.width).toBeGreaterThan(STICKY_MIN_SIZE_WORLD);
    }
    expect(await place(page, leftOut)).toEqual(wasLeftOut);
  });

  test('TC-33b: a resize stops where the note would stop being a note', async ({ page }) => {
    await openBoard(page);
    const id = await makeNote(page, MIDDLE, 'small');
    const was = await place(page, id);

    // Drag the top-left handle a long way past the bottom-right one. Without a floor the note is written
    // a width of nought — or a negative one, depending on the order the pointer was moved in — and a note
    // with no size cannot be grabbed again, which makes it a note nobody can find or delete.
    const box = await noteBox(page, await paintedIds(page).then((ids) => ids.indexOf(id)));
    await dragNote(page, { x: box.x, y: box.y }, STICKY_MIN_SIZE_WORLD + 300, STICKY_MIN_SIZE_WORLD + 300);

    const now = await place(page, id);
    expect(now.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
    expect(now.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
    // It shrank away from the corner that was held still — which is the corner the person dragging would
    // say they were holding on to.
    expect(now.x + now.width).toBeCloseTo(was.x + was.width, 0);
    expect(now.y + now.height).toBeCloseTo(was.y + was.height, 0);
    expect(await selectedIds(page)).toEqual([id]);
  });
});

test.describe('the keyboard on a selection', () => {
  test('TC-34: arrows nudge everything chosen without panning the board, and Delete removes them', async ({
    page,
  }) => {
    await openBoard(page);
    const first = await makeNote(page, { x: 300, y: 250 }, 'one');
    const second = await makeNote(page, { x: 700, y: 250 }, 'two');
    const leftOut = await makeNote(page, { x: 300, y: 620 }, 'three');
    await press(page, 'Escape');

    await dragBox(page, { x: 150, y: 100 }, { x: 900, y: 420 });
    expect((await selectedIds(page)).sort()).toEqual([first, second].sort());

    const before = new Map(await mapAll([first, second, leftOut], (id) => place(page, id)));
    const cameraWas = await getCamera(page);

    // One keystroke, one board unit. The step is deliberately small; it is the document that has to be
    // read to see it happen at all.
    await press(page, 'ArrowRight');
    expect(await place(page, first)).toEqual({ ...before.get(first)!, x: before.get(first)!.x + NUDGE_STEP_WORLD });
    expect(await place(page, second)).toEqual({
      ...before.get(second)!,
      x: before.get(second)!.x + NUDGE_STEP_WORLD,
    });

    // Shift is the difference between "a bit" and "a lot".
    await press(page, 'ArrowRight', 'shift');
    expect(await place(page, first)).toEqual({
      ...before.get(first)!,
      x: before.get(first)!.x + NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD,
    });

    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft', 'shift');
    await press(page, 'ArrowUp');

    // Through all five keystrokes the board did not pan and the page did not scroll: the notes moved and
    // the board they are drawn on stood still. A nudge that panned the view would look, to the person
    // pressing the key, exactly like a nudge that did nothing.
    expect(await getCamera(page)).toEqual(cameraWas);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    // The note that was never chosen never stirred.
    expect(await place(page, leftOut)).toEqual(before.get(leftOut)!);

    // Delete takes the whole selection, and the selection goes with it.
    await press(page, 'Delete');
    await expect.poll(() => noteCount(page)).toBe(1);
    expect(await selectedIds(page)).toEqual([]);
    expect(await outlines(page)).toBe(0);
    expect(await page.locator('[data-testid="selection-bar"]').count()).toBe(0);
    expect((await stickies(page))[0]!.id).toBe(leftOut);
  });

  test('TC-34b: the keys belong to the caret while a note is being written in', async ({ page }) => {
    await openBoard(page);
    const first = await makeNote(page, { x: 300, y: 250 }, 'abc');
    const second = await makeNote(page, { x: 700, y: 250 }, 'def');
    await dragBox(page, { x: 150, y: 100 }, { x: 900, y: 420 });
    expect(await selectedIds(page)).toHaveLength(2);
    const before = new Map((await stickies(page)).map((note) => [note.id, note]));
    const cameraWas = await getCamera(page);

    // One of the two chosen notes is opened for typing. From here the arrows, Enter, Delete and
    // Backspace all belong to the caret: a board that answered them itself would move the notes out from
    // under the person writing in one of them, and turn a Backspace that deletes a letter into one that
    // deletes the note.
    await noteAt(page, await paintedIds(page).then((ids) => ids.indexOf(second))).dblclick();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter');
    await settled(page);

    expect(await noteCount(page)).toBe(2);
    for (const id of [first, second]) {
      const now = await place(page, id);
      expect(now.x).toBe(before.get(id)!.x);
      expect(now.y).toBe(before.get(id)!.y);
    }
    expect(await getCamera(page)).toEqual(cameraWas);
    // What the caret did to the text is the note's own business; the note is still on the board.
    expect((await stickies(page)).map((note) => note.id).sort()).toEqual([first, second].sort());
  });
});

test.describe('a selection when somebody else deletes', () => {
  test('TC-35: a note deleted by somebody else leaves the selection, and the count says so', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, 2);
    const lee = people[0]!;
    const sam = people[1]!;
    try {
      // Lee lays out three notes and chooses all of them.
      const ids: string[] = [];
      for (const at of [
        { x: 300, y: 250 },
        { x: 700, y: 250 },
        { x: 300, y: 600 },
      ]) {
        ids.push(await makeNote(lee.page, at));
      }
      await press(lee.page, 'Escape');
      await press(lee.page, 'a', 'ctrl');
      await expect.poll(() => selectedIds(lee.page)).toHaveLength(3);
      const selectedWas = await selectedIds(lee.page);

      // Sam deletes one of the three from Sam's own page, while Lee is holding the selection.
      await expectEventually('Sam sees Lee\u2019s three notes', () => noteCount(sam.page)).toBe(3);
      const deleted = ids[1]!;
      await selectNoteById(sam, deleted);
      const since = Date.now();
      await press(sam.page, 'Delete');

      // Lee's selection loses that note: two outlines, and a bar that says two. A bar that went on
      // saying three would be the expensive kind of wrong, because Lee's next Delete would then be
      // aimed at three notes and would take two.
      await expectEventually('Lee\u2019s selection drops the note Sam deleted', async () =>
        (await selectedIds(lee.page)).sort(),
        { since },
      ).toEqual([...selectedWas.filter((id) => id !== deleted)].sort());
      expect(await selectionWords(lee.page)).toBe('2 selected');
      expect(await outlines(lee.page)).toBe(2);
      expect(await noteCount(lee.page)).toBe(2);
      // Nothing is left drawn where the note was. Sam's own selection went with the note Sam deleted,
      // and the two people are looking at the same board.
      expect(await selectedIds(sam.page)).toEqual([]);
      await expectConverged('both people hold the same board', [lee, sam]);

      // Lee's Delete now removes exactly the two notes that are still there.
      await press(lee.page, 'Delete');
      await expectEventually('the board is empty after Lee\u2019s Delete', () => noteCount(lee.page)).toBe(0);
      await expectEventually('Sam agrees the board is empty', () => noteCount(sam.page)).toBe(0);
      expect(await selectedIds(lee.page)).toEqual([]);
      expect(await outlines(lee.page)).toBe(0);
      expect(lee.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeParticipants(people);
      if (measurements().length > 0) logLatencies('selection and deletion latency');
    }
  });

  test('TC-35b: a note deleted out from under the caret stops being typed in', async ({ browser }) => {
    const people = await openParticipants(browser, 2);
    const lee = people[0]!;
    const sam = people[1]!;
    try {
      const survivor = await makeNote(lee.page, { x: 300, y: 250 }, 'kept');
      const typedIn = await makeNote(lee.page, { x: 700, y: 250 }, 'typed in');
      await expectEventually('Sam sees both notes', () => noteCount(sam.page)).toBe(2);

      // Both notes are chosen, and Lee is writing in one of them.
      await press(lee.page, 'Escape');
      await dragBox(lee.page, { x: 150, y: 100 }, { x: 950, y: 420 });
      await expect.poll(() => selectedIds(lee.page)).toHaveLength(2);
      await editNoteById(lee, typedIn);
      await editor(lee.page).type(' and more');

      // Sam deletes the note Lee is *not* writing in. Lee keeps typing: a delete somewhere else in a
      // selection is not a reason to take the caret away from a person in the middle of a sentence.
      await selectNoteById(sam, survivor);
      await press(sam.page, 'Delete');
      await expectEventually('Lee sees one note', () => noteCount(lee.page)).toBe(1);
      expect(await selectedIds(lee.page)).toEqual([typedIn]);
      expect(await editor(lee.page).inputValue()).toBe('typed in and more');

      // And add a letter, which is the same thing said with a keystroke instead of a reading — and then
      // read the document, because what matters is that Lee's typing got as far as the board rather than
      // stopping in the text box on the screen.
      await editor(lee.page).type('!');
      const remaining = await stickies(lee.page);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(typedIn);
      expect(remaining[0]!.text).toBe('typed in and more!');

      // Now Sam deletes the note the caret is in. The editor goes with it — a caret in a note that does
      // not exist is a cursor on nothing — and the selection is left holding what is still there.
      await selectNoteById(sam, typedIn);
      await press(sam.page, 'Delete');
      await expectEventually('the typing is over', () => lee.page.locator('[data-testid="sticky-textarea"]').count())
        .toBe(0);
      expect(await selectedIds(lee.page)).toEqual([]);
      expect(await noteCount(lee.page)).toBe(0);
      expect(await selectedIds(sam.page)).toEqual([]);
      await expectConverged('both people hold the same board', [lee, sam]);
      expect(lee.errors).toEqual([]);
      expect(sam.errors).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('as many people as the board is built for', () => {
  test('TC-36: everyone moves their own selection at once, and everybody ends up agreeing', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const people = await openParticipants(browser, CAPACITY);
    try {
      // One note each, far enough apart that nobody has to reach over somebody else's note to get to
      // their own. They are all made by the first person, so that the starting board is one board rather
      // than five races to create.
      const ids: string[] = [];
      for (let index = 0; index < CAPACITY; index += 1) {
        ids.push(await makeNote(people[0]!.page, { x: 180 + index * 220, y: 200 }));
        await press(people[0]!.page, 'Escape');
      }
      await expectConverged('everybody has the same five notes to start with', people);

      const before = new Map((await stickies(people[0]!.page)).map((note) => [note.id, note]));

      // Each person chooses their own note and moves it a different distance, all at the same time. The
      // distances differ so that a lost update cannot hide behind two people having written the same
      // numbers: if one move is dropped, one note ends up somewhere nobody put it.
      const moves = ids.map((_unused, index) => ({ x: 40 * (index + 1), y: 20 * (index + 1) }));
      const started = Date.now();
      await Promise.all(
        ids.map(async (id, index) => {
          const person = people[index]!;
          await selectNoteById(person, id);
          await dragNoteById(person, id, moves[index]!.x, moves[index]!.y);
        }),
      );

      // Every page has to come round to one board: the same notes, in the same places, in the same
      // order. Five people moving five notes is where a merge that quietly loses one of the five shows
      // up as two people looking at different boards.
      const agreed = await expectConverged('all five people agree after moving at once', people, {
        since: started,
        timeoutMs: 60_000,
      });
      for (const id of ids) expect(agreed).toContain(id);

      // And every one of the five moves is there, applied once: each note sits exactly where its own
      // mover left it, on every page.
      for (const person of people) {
        const notes = await stickies(person.page);
        expect(notes).toHaveLength(CAPACITY);
        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index]!;
          const was = before.get(id)!;
          const now = notes.find((note) => note.id === id)!;
          expect(now.x, `${person.name}: note ${index} x`).toBeCloseTo(was.x + moves[index]!.x, 1);
          expect(now.y, `${person.name}: note ${index} y`).toBeCloseTo(was.y + moves[index]!.y, 1);
        }
        // The selection each person was holding is still theirs, and still holds their own note: a
        // remote move of a neighbouring note must not reach into somebody else's selection.
        expect(await selectedIds(person.page)).toEqual([ids[people.indexOf(person)]!]);
      }
      for (const person of people) expect(person.errors, `${person.name} logged errors`).toEqual([]);
    } finally {
      await closeParticipants(people);
      if (measurements().length > 0) logLatencies('five people, five moves');
    }
  });
});
