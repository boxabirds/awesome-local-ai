import { expect, test, type Page } from '@playwright/test';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { boardNotes, expectClose, gotoBoard, pressShortcut } from './helpers/board';
import {
  boardLink,
  capacity,
  closeParticipants,
  createBoard,
  createParticipants,
  expectConverged,
  expectNoErrors,
  type Participant,
} from './helpers/participants';
import {
  createNotes,
  dragHandle,
  dragSpot,
  escape,
  markerOf,
  selectionCountText,
  selectedIds,
  shiftDrag,
  waitForSelection,
  type Point,
} from './helpers/selection';
import {
  activeTool,
  clickTextSize,
  createTextOnBoardAt,
  deleteSelection,
  endTextEdit,
  fontOf,
  handleNames,
  pressedSizeButtons,
  pressTextTool,
  renderedLines,
  startTextEdit,
  textElement,
  textOf,
  texts,
  waitForTextCount,
} from './helpers/text';

/**
 * Story 9 in a real browser: writing free text anywhere on the board. Real fonts decide how
 * wide a word is and where its lines wrap, which is why the two tests about wrapping measure
 * what the browser painted — the honest number — and never the client's own arithmetic.
 *
 * Every board here is opened at 100% zoom, so one screen pixel is one board unit.
 */

/** Somewhere on empty board, away from the controls, the hint and the notes below. */
const OPEN = { x: 300, y: 220 };
const AWAY = { x: 700, y: 560 };

/** A cluster of notes to put a heading over (the PRD's retro board). */
const CLUSTER: Point[] = [
  { x: 300, y: 480 },
  { x: 520, y: 480 },
  { x: 300, y: 700 },
];

/** The first 300 characters of a longer paragraph: the design's long-annotation fixture. */
const ANNOTATION = [
  'we agreed that the retro would keep three sections and that each one would hold no more than a ',
  'dozen cards, because a board nobody can read in a minute is a board nobody reads again next week ',
  'and by the end of the afternoon we had covered every inch of the wall with pink paper and chalk, ',
  'and nobody could remember which of the three sections we had actually agreed to keep on ',
]
  .join('')
  .slice(0, 300);

test('TC-26: a long annotation wraps at the comfortable width, in every browser', async ({ page }) => {
  await openBoard(page);
  expect(ANNOTATION).toHaveLength(300);

  const id = await createTextOnBoardAt(page, OPEN);
  await page.keyboard.type(ANNOTATION);
  await endTextEdit(page);

  // It stopped widening at the comfortable line length instead of running off the board.
  const stored = await textOf(page, id);
  expectClose(stored.width, TEXT_MAX_AUTO_WIDTH_WORLD, 2);
  expect(stored.widthMode).toBe('auto');
  // It never became a single endless line: the browser wrapped it into several.
  expect(await renderedLines(page, id)).toBeGreaterThanOrEqual(3);
  // The box the board drew agrees with the box the document holds.
  const drawn = await textElement(page, id);
  expectClose(drawn.height, stored.height, 2);
  // And the tool went back to Select on its own, so the next click is a click.
  expect(await activeTool(page)).toBe('select');
});

test('TC-27: the side handle sets a fixed width; the height stays the text’s own', async ({ page }) => {
  await openBoard(page);
  const id = await createTextOnBoardAt(page, OPEN);
  await page.keyboard.type(ANNOTATION);
  await endTextEdit(page);
  const before = await textOf(page, id);
  const linesBefore = await renderedLines(page, id);

  // One text selected: a handle on each side and none on top or bottom, because its height is
  // what its text needs — there is nothing for a vertical handle to mean.
  expect(await handleNames(page)).toEqual(['e', 'w']);

  await dragHandle(page, 'e', { x: -150, y: 0 });

  const after = await textOf(page, id);
  expect(after.widthMode).toBe('fixed');
  expectClose(after.width, before.width - 150, 3);
  expect(after.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
  // The same words in a narrower box: more lines, so a taller box.
  const linesAfter = await renderedLines(page, id);
  expect(linesAfter).toBeGreaterThan(linesBefore);
  expect(after.height).toBeGreaterThan(before.height);
  expect((await textElement(page, id)).widthMode).toBe('fixed');
  // Still exactly the two handles after the drag.
  expect(await handleNames(page)).toEqual(['e', 'w']);
});

test('TC-28: a heading is written, sized, dragged over the cluster, deleted and undone', async ({ page }) => {
  await openBoard(page);
  const notes = await createNotes(page, CLUSTER);
  await expect.poll(async () => (await boardNotes(page)).length).toBe(CLUSTER.length);

  // "Click empty space above a cluster of notes."
  const heading = await createTextOnBoardAt(page, { x: 380, y: 200 });
  await page.keyboard.type('Went well');
  await endTextEdit(page);
  const placed = await textOf(page, heading);
  expect(placed.text).toBe('Went well');
  expect(placed.size).toBe('M');
  // It is above every note in the cluster.
  const cluster = (await boardNotes(page)).filter((note) => note.type === 'sticky');
  expect(placed.y + placed.height).toBeLessThan(Math.min(...cluster.map((note) => note.y)));

  // "In the small toolbar above it she picks XL."
  expect(await pressedSizeButtons(page)).toEqual(['M']);
  await clickTextSize(page, 'XL');
  const sized = await textOf(page, heading);
  expect(sized.size).toBe('XL');
  expect(sized.x).toBe(placed.x);
  expect(sized.y).toBe(placed.y);
  expect(sized.height).toBeGreaterThan(placed.height);
  expect((await textElement(page, heading)).fontPx).toBe(fontOf('XL'));

  // "She drags it over the notes."
  const first = notes[0];
  if (!first) throw new Error('no cluster note');
  const over = await markerOf(page, first);
  await dragSpot(page, await markerOf(page, heading), over);
  const moved = await textOf(page, heading);
  expect(moved.x).not.toBe(placed.x);
  expect(moved.y).not.toBe(placed.y);
  expect(await overlap(page, heading, first)).toBe(true);

  // "One of them changes her mind: Delete." The same delete any other object gets.
  await deleteSelection(page);
  await expect.poll(async () => (await texts(page)).length, { timeout: 10_000 }).toBe(0);
  expect(await page.locator(`[data-note-id="${heading}"]`).count()).toBe(0);
  // Nothing else went with it.
  expect((await boardNotes(page)).length).toBe(CLUSTER.length);

  // "Ctrl+Z brings it back, with the heading in it."
  await pressShortcut(page, 'Control+z');
  await waitForTextCount(page, 1);
  const back = await textOf(page, heading);
  expect(back.text).toBe('Went well');
  expect(back.size).toBe('XL');
  expect(await page.locator(`[data-note-id="${heading}"]`).count()).toBe(1);
});

test('TC-29: two people typing into one heading end up with one heading', async ({ browser }) => {
  const boardId = await createBoard(browser);
  const people = await createParticipants(browser, boardLink(boardId), 2);
  try {
    const [alex, sam] = people as [Participant, Participant];
    const heading = await createTextOnBoardAt(alex.page, OPEN);
    await alex.page.keyboard.type('Retro ');
    await endTextEdit(alex.page);
    await expectConverged(people);

    // Both open the same heading and type into it at the same time.
    await startTextEdit(alex.page, heading);
    await startTextEdit(sam.page, heading);
    await Promise.all([
      alex.page.keyboard.type('went', { delay: 30 }),
      sam.page.keyboard.type('well', { delay: 30 }),
    ]);
    await endTextEdit(alex.page);
    await endTextEdit(sam.page);

    await expectConverged(people);
    const here = (await textOf(alex.page, heading)).text;
    const there = (await textOf(sam.page, heading)).text;
    expect(here).toBe(there);
    // Every character either of them typed is in it exactly once, in whatever order the two
    // streams arrived: nothing lost, nothing doubled.
    expect(letters(here)).toBe(letters('Retro wentwell'));
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-30: everyone writes a heading at once and every screen shows them all', async ({ browser }) => {
  const boardId = await createBoard(browser);
  const people = await createParticipants(browser, boardLink(boardId), capacity());
  try {
    const spots: Point[] = [
      { x: 220, y: 200 },
      { x: 520, y: 200 },
      { x: 820, y: 200 },
      { x: 220, y: 430 },
      { x: 520, y: 430 },
    ].slice(0, capacity());
    const words = people.map((_, index) => `heading ${index + 1}`);

    // All of them, at once: the Text tool, a click, a heading, Escape.
    await Promise.all(
      people.map(async (person, index) => {
        const id = await createTextOnBoardAt(person.page, spots[index] as Point);
        await person.page.keyboard.type(words[index] as string);
        await endTextEdit(person.page);
        await expect
          .poll(async () => (await textOf(person.page, id)).text, { message: 'the heading' })
          .toBe(words[index]);
      }),
    );

    await expectConverged(people);
    for (const person of people) {
      await expect
        .poll(async () => (await texts(person.page)).map((text) => text.text).sort(), {
          timeout: 10_000,
          message: `${person.name} sees every heading`,
        })
        .toEqual([...words].sort());
      // And they are drawn, not merely sitting in the document.
      await expect(person.page.locator('[data-note-type="text"]')).toHaveCount(capacity());
    }
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-31: text abandoned before it was typed is not left on the board', async ({ page }) => {
  await openBoard(page);
  const spot = { x: 360, y: 300 };

  const id = await createTextOnBoardAt(page, spot);
  expect((await textElement(page, id)).editing).toBe(true);
  await escape(page); // nothing was typed

  // No object in the document and none on the screen: it never became an invisible something.
  await expect.poll(async () => (await texts(page)).length, { timeout: 10_000 }).toBe(0);
  expect(await page.locator(`[data-note-id="${id}"]`).count()).toBe(0);
  expect(await page.locator('button[aria-label="Delete selection"]').count()).toBe(0);

  // And a marquee drawn over the spot it was made on selects nothing.
  await shiftDrag(page, { x: spot.x - 60, y: spot.y - 60 }, { x: spot.x + 180, y: spot.y + 180 });
  expect(await selectedIds(page)).toEqual([]);
  expect(await selectionCountText(page)).toBeNull();
});

test('double-clicking with the Text tool up makes no sticky note', async ({ page }) => {
  await openBoard(page);
  await pressTextTool(page);
  expect(await activeTool(page)).toBe('text');

  // Story 2's double-click is off while a tool that writes text is up: what appears is text.
  await page.mouse.dblclick(AWAY.x, AWAY.y);
  await escape(page);
  expect((await boardNotes(page)).filter((note) => note.type === 'sticky')).toHaveLength(0);
  await expect.poll(async () => (await texts(page)).length, { timeout: 10_000 }).toBe(0);
});

test('a text object is selected, moved and deleted like any other object', async ({ page }) => {
  await openBoard(page);
  const [note] = await createNotes(page, [CLUSTER[0] as Point]);
  const text = await createTextOnBoardAt(page, AWAY);
  await page.keyboard.type('Both of us');
  await endTextEdit(page);

  // Ctrl+A takes the note and the text together, and the bar counts two of them.
  await page.keyboard.press('Control+a');
  await waitForSelection(page, [note as string, text]);
  expect(await selectionCountText(page)).toBe('2 selected');

  // A mixed selection gets all eight handles, and dragging one moves the text too.
  expect(await handleNames(page)).toHaveLength(8);
  const before = await textOf(page, text);
  await dragSelectedBy(page, { x: 120, y: 60 });
  const after = await textOf(page, text);
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeGreaterThan(before.y);

  // Delete takes both, in one undo step.
  await deleteSelection(page);
  await expect.poll(async () => (await boardNotes(page)).length, { timeout: 10_000 }).toBe(0);
  // One Ctrl+Z brings both back: the delete was one step, whatever was deleted.
  await pressShortcut(page, 'Control+z');
  await waitForTextCount(page, 1);
  const restored = (await boardNotes(page)).filter((note) => note.type === 'sticky');
  expect(restored).toHaveLength(1);
  expect((await texts(page))[0]?.text).toBe('Both of us');
});

/* ---------------------------------------------------------------- helpers */

async function openBoard(page: Page): Promise<void> {
  // `gotoBoard` presses the app's own "New board" and waits for the board to be centred.
  await gotoBoard(page);
}

/** Grab the selected object (a text, in these tests) and move it by (dx, dy). */
async function dragSelectedBy(page: Page, by: Point): Promise<void> {
  const selected = await selectedIds(page);
  if (selected.length === 0) throw new Error('nothing selected to drag');
  const from = await markerOf(page, selected[0] as string);
  await dragSpot(page, from, { x: from.x + by.x, y: from.y + by.y }, 6);
}

/** Do the two objects' boxes share any ground? */
async function overlap(page: Page, first: string, second: string): Promise<boolean> {
  const a = await boxOf(page, first);
  const b = await boxOf(page, second);
  return !(
    b.x > a.x + a.width ||
    a.x > b.x + b.width ||
    b.y > a.y + a.height ||
    a.y > b.y + b.height
  );
}

/** An object's box in board units, whatever type it is. */
async function boxOf(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((objectId) => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    const value = objects[objectId];
    if (!value) throw new Error(`no object ${objectId} in the document`);
    return {
      x: Number(value.x),
      y: Number(value.y),
      width: Number(value.width),
      height: Number(value.height),
    };
  }, id);
}

/** Sorted characters, so two texts can be compared without caring about order. */
function letters(text: string): string {
  return [...text].sort().join('');
}
