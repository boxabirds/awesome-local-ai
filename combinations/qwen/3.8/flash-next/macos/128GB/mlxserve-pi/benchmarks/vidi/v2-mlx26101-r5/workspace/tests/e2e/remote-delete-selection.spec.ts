/**
 * Story 7, the race a whiteboard actually has: I am holding four notes, and a colleague deletes one
 * of them.
 *
 * A selection is a list of ids, and an id outlives the thing it named by exactly the distance between
 * two people's screens. What this test insists on is that the board notices — that the selection
 * shrinks instead of pointing at nothing, that the count on the bar is the count of notes on the
 * screen, and that the delete which caused it takes exactly the note it was asked to take and leaves
 * the other sixteen alone.
 *
 * Design matrix: TC-35 (prune), two browser contexts.
 */
import { expect, test } from '@playwright/test';

import { unionRects, type Point } from '../../src/shared/geometry';
import {
  clickNote,
  expectNoteCount,
  expectObjectCount,
  expectSelectionCount,
  marqueeDrag,
  objectInteraction,
  objectOf,
  objectWorld,
  overlayWorld,
  screenOfWorld,
  selectedIds,
  selectionBar,
  selectionBarCount,
  setCamera,
  type WorldRect,
} from './helpers/board';
import { DEFAULT_WS_ORIGIN } from './helpers/boards';
import {
  closeParticipants,
  expectChangeToArrive,
  expectNoConsoleErrors,
  expectSameBoard,
  latencyReport,
  latencySamples,
  newBoard,
  noteCount,
  openParticipants,
  resetLatencySamples,
  writeLatencyReport,
} from './helpers/participants';
import { RoomClient } from './helpers/room-client';

/** The room, spoken to from outside a browser: twenty notes is a board, not a demo. */
async function seedTwentyNotes(boardId: string): Promise<void> {
  const writer = await RoomClient.connect(DEFAULT_WS_ORIGIN, boardId);
  // One row of twenty, with a gap between neighbours wide enough for a marquee to stop inside it.
  writer.createNotes(20, 260);
  await writer.settle();
  await writer.close();
}

/** The box a set of objects fills together, in world units — asked of the board's own geometry. */
function union(rects: readonly WorldRect[]): WorldRect {
  const box = unionRects(rects);
  if (box === null) throw new Error('there was nothing to box in');
  return box;
}

/**
 * The two corners of this rectangle with room around it: enough to enclose the notes inside it, and
 * — because the notes in this fixture are laid out with a wider gap than the room — not enough to
 * reach the next one.
 */
function corners(rect: WorldRect, room: number): { from: Point; to: Point } {
  return {
    from: { x: rect.x - room, y: rect.y - room },
    to: { x: rect.x + rect.width + room, y: rect.y + rect.height + room },
  };
}

test('TC-35 a note a colleague deletes leaves the selection, and the count says so', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  resetLatencySamples();
  const boardId = newBoard();
  const [lee, sam] = await openParticipants(browser, ['Lee', 'Sam'], boardId);

  // Twenty notes, written from outside both browsers. The board has sixteen notes on it that
  // nobody selected, which is what makes "the rest are untouched" a statement worth checking.
  await seedTwentyNotes(boardId);
  const ids = await expectNoteCount(lee.page, 20);
  await expectNoteCount(sam.page, 20);

  // Lee zooms out, because four notes in a row do not fit on one screen at 100 %, and then draws a
  // rectangle around the four leftmost. The corners are computed from where the board says those
  // notes are, and converted to screen points by the camera the page is rendering.
  await setCamera(lee.page, { zoom: 0.5 });
  const places = new Map<string, WorldRect>();
  for (const id of ids) places.set(id, await objectWorld(lee.page, id));
  const leftmost = [...ids].sort((a, b) => places.get(a)!.x - places.get(b)!.x);
  const four = leftmost.slice(0, 4) as string[];
  const chosen = corners(union(four.map((id) => places.get(id)!)), 20);

  await marqueeDrag(
    lee.page,
    await screenOfWorld(lee.page, chosen.from),
    await screenOfWorld(lee.page, chosen.to),
  );
  expect((await selectedIds(lee.page)).sort()).toEqual([...four].sort());
  expect(await expectSelectionCount(lee.page, 4)).toBe('4 selected');
  // The box on the screen is the box those four notes fill.
  const box = await overlayWorld(lee.page);
  expect(box!.width).toBeCloseTo(union(four.map((id) => places.get(id)!)).width, 5);

  // Sam, in another browser, selects one of those four and deletes it. Sam is not dragging
  // anything, is not editing anything: this is the ordinary case of a board being a shared place.
  const victim = four[1] as string;
  await clickNote(sam.page, victim);
  expect(await selectedIds(sam.page)).toEqual([victim]);
  await sam.page.keyboard.press('Delete');

  // On Lee's screen the selection shrinks around the hole. The design gives a live change a second
  // to arrive; the helper measures how long it took and reports it, and waits as long as it takes.
  const remaining = four.filter((id) => id !== victim);
  await expectChangeToArrive([lee], 'the selection dropping the note that was deleted', () =>
    selectionBarCount(lee.page).then((count) => count === 3),
  );

  // The note is gone from Lee's board, and no part of the interface is still pointing at it.
  expect(await objectOf(lee.page, victim).count()).toBe(0);
  expect((await selectedIds(lee.page)).sort()).toEqual([...remaining].sort());
  expect(await expectSelectionCount(lee.page, 3)).toBe('3 selected');
  // The other three are still outlined, each one of them still marked selected.
  for (const id of remaining) {
    expect(await objectInteraction(lee.page, id)).toBe('selected');
  }
  // And the box is now the box those three fill, not the one the four did.
  const shrunk = await overlayWorld(lee.page);
  const expected = union(await Promise.all(remaining.map((id) => objectWorld(lee.page, id))));
  expect(shrunk!.x).toBeCloseTo(expected.x, 5);
  expect(shrunk!.width).toBeCloseTo(expected.width, 5);
  expect(shrunk!.height).toBeCloseTo(expected.height, 5);

  // Lee deletes what is left of the selection: exactly those three go, and the sixteen notes that
  // were never selected are where they always were.
  const survivors = ids.filter((id) => !four.includes(id));
  const before = new Map<string, WorldRect>();
  for (const id of survivors.slice(0, 5)) before.set(id, await objectWorld(lee.page, id));
  await lee.page.keyboard.press('Delete');

  await expectObjectCount(lee.page, 16);
  expect(await selectionBar(lee.page).count(), 'the bar went away with the selection').toBe(0);
  expect(await selectedIds(lee.page)).toEqual([]);
  expect(await overlayWorld(lee.page)).toBeNull();
  for (const [id, was] of before) {
    const now = await objectWorld(lee.page, id);
    expect(now.x, `note ${id} was not in anybody's selection`).toBeCloseTo(was.x, 6);
    expect(now.y).toBeCloseTo(was.y, 6);
  }

  // Both browsers agree about what the two deletes took.
  await expectChangeToArrive([sam], 'sixteen notes left on the board', (other) =>
    noteCount(other.page).then((seen) => seen === 16),
  );
  await expectSameBoard([lee, sam], 'Lee and Sam hold the same board', 30_000);

  console.info(`${latencyReport(latencySamples())} for the remote delete to shrink a selection`);
  expectNoConsoleErrors([lee, sam]);
  await writeLatencyReport(testInfo, 'tc-35-remote-delete');
  await closeParticipants([lee, sam]);
});

/** Whether the bar has gone away, which is the selection being too small for one. */
