import { expect, test, type Page } from '@playwright/test';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardNotes,
  dragBoard,
  gotoBoard,
  noteRect,
  pressShortcut,
  readCamera,
  settle,
  waitForNoteCount,
  type NoteRecord,
} from './helpers/board';
import {
  boardLink,
  capacity,
  closeParticipants,
  createBoard,
  createNoteAt,
  createParticipants,
  deleteNote,
  endEditing,
  expectConverged,
  expectNoErrors,
  notesOf,
  positionOf,
  type Participant,
} from './helpers/participants';
import {
  clickNote,
  clickSpot,
  createNotes,
  dragHandle,
  dragSpot,
  expectSelectionCount,
  marqueeBox,
  markerOf,
  selectionBox,
  selectedIds,
  selectionCountText,
  shiftClickNote,
  shiftClickSpot,
  waitForSelection,
  type Point,
} from './helpers/selection';

/**
 * Story 7 in a real browser: several objects at once. Where a marquee ends, where a group
 * of objects ends after being moved and resized together, what the keyboard does to a
 * selection, and what happens to a selection when somebody else deletes part of it.
 *
 * Every board here is opened at 100% zoom, so one screen pixel is one board unit and the
 * numbers below can be read off the screen.
 */

// Notes are 200 wide, so these centres are 20 units apart in each direction.
const A = { x: 250, y: 250 };
const B = { x: 500, y: 250 };
const C = { x: 900, y: 600 };
const D = { x: 900, y: 250 };

/** A rectangle that holds A completely, clips B, and stays away from C. */
const MARQUEE = { from: { x: 120, y: 120 }, to: { x: 480, y: 480 } };

/** A cluster of three notes and a fourth outside it. */
const CLUSTER = [
  { x: 300, y: 250 },
  { x: 520, y: 250 },
  { x: 300, y: 470 },
];

/** Ten notes in two rows of five, for the full-capacity test. */
const ROSTER: Point[] = [200, 420, 640, 860, 1080].flatMap((x) =>
  [220, 460].map((y) => ({ x, y })),
);

test('TC-32: a marquee selects only what is completely inside it', async ({ page }) => {
  await openBoard(page);
  const [a, b, c] = await createNotes(page, [A, B, C]);
  const before = await positions(page);
  const camera = await readCamera(page);

  // Draw the rectangle by hand rather than with the helper, because half of what this
  // tests is what it looks like while it is being drawn.
  await page.keyboard.down('Shift');
  await page.mouse.move(MARQUEE.from.x, MARQUEE.from.y);
  await page.mouse.down();
  await page.mouse.move(300, 300);
  const drawn = await marqueeBox(page);
  expect(drawn, 'the rectangle is drawn while the pointer is down').not.toBeNull();
  expect(drawn?.x).toBeCloseTo(MARQUEE.from.x, 0);
  expect(drawn?.width).toBeCloseTo(300 - MARQUEE.from.x, 0);
  expect(await page.locator('[data-testid="marquee"]').count()).toBe(1);
  await page.mouse.move(MARQUEE.to.x, MARQUEE.to.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);

  // A inside, B half in, C outside: only A.
  await waitForSelection(page, [a]);
  expect(await page.getAttribute(`[data-note-id="${b}"]`, 'data-selected')).toBe('false');
  expect(await page.getAttribute(`[data-note-id="${c}"]`, 'data-selected')).toBe('false');
  expect(await marqueeBox(page)).toBeNull();
  expect(await positions(page)).toEqual(before);
  expect(await readCamera(page)).toEqual(camera);

  // One object is a single selection: no bar.
  expect(await selectionCountText(page)).toBeNull();

  // And a drag without Shift is still the story 1 pan, which selects nothing.
  await dragBoard(page, { x: 120, y: 700 }, { x: 320, y: 760 });
  const panned = await readCamera(page);
  expect(panned.x).not.toBe(camera.x);
  expect(await selectedIds(page)).toEqual([a]);
});

test('TC-33: a group moves together, and resizing its box scales sizes and gaps', async ({
  page,
}) => {
  await openBoard(page);
  const [a, b, c] = await createNotes(page, CLUSTER);
  const [alone] = await createNotes(page, [D]);
  const untouched = await positions(page);

  await clickNote(page, a);
  await shiftClickNote(page, b);
  await shiftClickNote(page, c);
  await expectSelectionCount(page, '3 selected');

  // The box is the union of the three notes it holds: 420x420 of them.
  const box = await selectionBox(page);
  expect(box?.x).toBeCloseTo(200, 0);
  expect(box?.width).toBeCloseTo(420, 0);
  expect(box?.height).toBeCloseTo(420, 0);

  // Dragging any one of the three moves all three by the same offset, and the fourth note
  // (which is not selected) does not move at all.
  const from = await markerOf(page, a);
  await dragSpot(page, from, { x: from.x - 100, y: from.y - 60 });
  const moved = await positions(page);
  for (const id of [a, b, c]) {
    expect(moved[id].x - untouched[id].x).toBeCloseTo(-100, 0);
    expect(moved[id].y - untouched[id].y).toBeCloseTo(-60, 0);
  }
  expect(moved[alone]).toEqual(untouched[alone]);

  // Now every note on the board is selected and its box is resized from a corner: sizes
  // and the gaps between them scale by the same factor, and the notes stay square.
  await pressShortcut(page, 'a');
  await expectSelectionCount(page, '4 selected');
  const sizes = await screenSizes(page, [a, b, c, alone]);
  const gaps = await gapBetween(page, a, b);
  const all = await selectionBox(page);
  expect(all).not.toBeNull();

  // 1.1x the box in both axes, which is the ratio a sticky note keeps whatever handle is
  // used for it.
  await dragHandle(page, 'se', { x: Math.round(all!.width * 0.1), y: Math.round(all!.height * 0.1) });

  const after = await screenSizes(page, [a, b, c, alone]);
  for (const id of [a, b, c, alone]) {
    const scale = after[id].width / sizes[id].width;
    expect(scale, `note ${id} grew by the box's factor`).toBeCloseTo(1.1, 1);
    expect(after[id].height / sizes[id].height, `note ${id} kept its ratio`).toBeCloseTo(1.1, 1);
    // Square in, square out.
    expect(after[id].height).toBeCloseTo(after[id].width, 0);
  }
  const afterGaps = await gapBetween(page, a, b);
  expect(afterGaps.horizontal / gaps.horizontal).toBeCloseTo(1.1, 1);
  // The notes grew from their own boxes: none of them fell apart into a strip.
  expect(after[a].width).toBeGreaterThan(STICKY_MIN_SIZE_WORLD);
  expect(after[a].width).toBeLessThan(STICKY_SIZE_WORLD * 2);
  expect((await readCamera(page)).zoom).toBe(1);
});

test('TC-34: the arrow keys move the selection without scrolling the page or panning, and Delete removes all of it', async ({
  page,
}) => {
  await openBoard(page);
  const ids = await createNotes(page, [A, B, C, D]);
  const before = await positions(page);
  const camera = await readCamera(page);

  await pressShortcut(page, 'a');
  await expectSelectionCount(page, '4 selected');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');

  const nudged = await positions(page);
  for (const id of ids) {
    expect(nudged[id].x - before[id].x, `note ${id} moved right 11`).toBeCloseTo(11, 6);
    expect(nudged[id].y - before[id].y, `note ${id} moved down 11`).toBeCloseTo(11, 6);
  }
  // The board did not pan and the page did not scroll: the keys went to the selection.
  expect(await readCamera(page)).toEqual(camera);
  expect(await page.evaluate(() => `${window.scrollY},${document.documentElement.scrollTop}`)).toBe(
    '0,0',
  );

  await page.keyboard.press('Delete');
  await waitForNoteCount(page, 0);
  expect(await selectedIds(page)).toEqual([]);
  expect(await selectionCountText(page)).toBeNull();
});

test('TC-35: when somebody else deletes one of my selected notes, my selection count follows', async ({
  browser,
}) => {
  const boardId = await createBoard(browser);
  const people = await createParticipants(browser, boardLink(boardId), 2);
  try {
    const [alex, sam] = people as [Participant, Participant];
    const spots = [
      { x: 300, y: 250 },
      { x: 520, y: 250 },
      { x: 300, y: 470 },
      { x: 520, y: 470 },
    ];
    const ids: string[] = [];
    for (const spot of spots) {
      ids.push(await createNoteAt(alex, spot));
      await endEditing(alex);
    }
    await waitForNoteCount(sam.page, ids.length);

    await pressShortcut(alex.page, 'a');
    await expectSelectionCount(alex.page, '4 selected');

    // Sam deletes one of Alex's four selected notes.
    await deleteNote(sam, ids[0]);

    // Alex's selection loses that note by itself: 3 selected, and its outline is gone.
    await expectSelectionCount(alex.page, '3 selected');
    await expect
      .poll(() => selectedIds(alex.page), { timeout: 10_000 })
      .toEqual([ids[1], ids[2], ids[3]].sort());
    expect(await hasNote(alex, ids[0])).toBe(false);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-36: at full capacity, everybody moves their own selection and every browser ends with the same board', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const boardId = await createBoard(browser);
  const people = await createParticipants(browser, boardLink(boardId), capacity());
  try {
    const [host, ...others] = people;
    const ids: string[] = [];
    for (const spot of ROSTER) {
      ids.push(await createNoteAt(host, spot));
      await endEditing(host);
    }
    for (const person of others) await waitForNoteCount(person.page, ids.length);

    const before = new Map<string, Point>();
    for (const note of await notesOf(host)) before.set(note.id, { x: note.x, y: note.y });
    expect([...before.keys()].sort()).toEqual([...ids].sort());

    // Each person takes a different pair of notes and drags one of them by their own
    // offset, all at the same time.
    const moves = people.map((_, index) => ({
      x: 24 + index * 10,
      y: -18 - index * 6,
    }));
    await Promise.all(
      people.map(async (person, index) => {
        const mine = [ids[index * 2], ids[index * 2 + 1]];
        await clickSpot(person.page, await markerOf(person.page, mine[0]));
        await shiftClickSpot(person.page, await markerOf(person.page, mine[1]));
        await expectSelectionCount(person.page, '2 selected');
        const at = await markerOf(person.page, mine[0]);
        await dragSpot(person.page, at, {
          x: at.x + moves[index].x,
          y: at.y + moves[index].y,
        });
      }),
    );

    // Every browser agrees on where every note ended up: the same board, five times.
    for (const person of people) {
      for (const id of ids) {
        const start = before.get(id);
        if (!start) throw new Error(`no starting position for note ${id}`);
        const index = Math.floor(ids.indexOf(id) / 2);
        const to = { x: Math.round(start.x + moves[index].x), y: Math.round(start.y + moves[index].y) };
        await expect
          .poll(
            async () => {
              const at = await positionOf(person, id);
              return { x: Math.round(at.x), y: Math.round(at.y) };
            },
            { timeout: 15_000, message: `${person.name} sees note ${id} at its new place` },
          )
          .toEqual(to);
      }
    }
    await expectConverged(people);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

/* ------------------------------------------------------------- helpers */

/** A board of this run's own, opened and centred. */
async function openBoard(page: Page): Promise<void> {
  // `gotoBoard` presses the app's own "New board" and waits for the board to be centred.
  await gotoBoard(page);
}

/** Where the board says each note is, by id. */
async function positions(page: Page): Promise<Record<string, Point>> {
  const notes: NoteRecord[] = await boardNotes(page);
  return Object.fromEntries(notes.map((note) => [note.id, { x: note.x, y: note.y }]));
}

/** A note's painted box, by id. */
async function screenSizes(page: Page, ids: readonly string[]): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const id of ids) out[id] = await noteRect(page, id);
  return out;
}

/** The horizontal gap between two notes that sit side by side. */
async function gapBetween(page: Page, left: string, right: string): Promise<{ horizontal: number }> {
  const a = await noteRect(page, left);
  const b = await noteRect(page, right);
  return { horizontal: b.x - (a.x + a.width) };
}

async function hasNote(person: Participant, id: string): Promise<boolean> {
  return (await person.page.locator(`[data-note-id="${id}"]`).count()) > 0;
}
