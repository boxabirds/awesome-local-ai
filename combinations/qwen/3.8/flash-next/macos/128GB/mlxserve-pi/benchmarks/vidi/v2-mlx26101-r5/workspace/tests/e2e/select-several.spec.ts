/**
 * Story 7, the parts only a browser can answer: does a rectangle pulled with the mouse take what is
 * under it, do six notes really travel together and scale together, do the arrow keys move a
 * selection instead of a page, and do five people doing all of that at once still end up on the same
 * board?
 *
 * The numbers in here are computed rather than guessed. Every expectation about a world position is
 * derived from the camera the page is actually rendering (`readCamera`) and from the object's own
 * numbers as the board reports them, so the test says what a person would see even when the starting
 * camera is somebody else's choice. Positions are compared in *world* units, where a drag of 150
 * pixels at 50 % zoom is exactly the 300 units the design talks about.
 *
 * Design matrix: TC-32 (marquee), TC-33 (group drag and resize at scale), TC-34 (keyboard nudge and
 * delete), TC-36 (concurrent at capacity).
 */
import { expect, test } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  clickEmptySpace,
  createNotesAt,
  dragFromPoint,
  dragObjectAndSettle,
  expectObjectCount,
  expectSelectionCount,
  handleNames,
  handleScreen,
  marqueeDrag,
  marqueeWorld,
  nudgeKeys,
  objectInteraction,
  objectWorld,
  openBoard,
  overlayWorld,
  pageScroll,
  readCamera,
  selectAllKeys,
  selectionBarCount,
  selectionOverlay,
  selectObjects,
  selectedIds,
  setCamera,
  shiftClickObject,
  waitForObjectAtRest,
  waitForOverlayAtRest,
  type WorldRect,
} from './helpers/board';
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
  type Participant,
} from './helpers/participants';

const NAMES = ['Alex', 'Sam', 'Robin', 'Jo', 'Casey'] as const;

/** Everyone but the person who just did something, which is who has to see it. */
function everyoneElse(people: readonly Participant[], person: Participant): Participant[] {
  return people.filter((other) => other !== person);
}

/** Where TC-33's cluster of six goes, on screen: two rows of three, plus a note beside them. */
const CLUSTER_XS = [250, 400, 550];
const CLUSTER_YS = [200, 350];

/**
 * Ids that exist. A board that failed to make a note is a failed test, and this way it says so here
 * rather than three assertions later as `undefined`.
 */
function present(ids: readonly (string | undefined)[]): string[] {
  return ids.map((id, index) => {
    if (typeof id !== 'string' || id === '') throw new Error(`note ${index + 1} was never made`);
    return id;
  });
}

test('TC-32 a rectangle pulled over the board takes the note inside it and leaves the one it only covers halfway', async ({
  page,
}) => {
  await openBoard(page);
  const camera = await readCamera(page);

  // Three notes: one the rectangle will enclose, one it will cut in half, one nowhere near it.
  const [inside, half, elsewhere] = present(
    await createNotesAt(page, [
      { x: 400, y: 300 },
      { x: 700, y: 300 },
      { x: 1000, y: 600 },
    ]),
  ) as [string, string, string];
  // Creating a note leaves it selected; start from nobody being selected at all.
  await clickEmptySpace(page, { x: 150, y: 720 });
  expect(await selectedIds(page)).toEqual([]);

  const from = { x: 250, y: 150 };
  const to = { x: 650, y: 450 };
  const cameraBefore = await readCamera(page);

  await marqueeDrag(page, from, to, async () => {
    // While the button is down there is a rectangle, and it is described in world units: the
    // pixels it covers are the pixels of the screen, the numbers are the board's.
    const pulled = await marqueeWorld(page);
    expect(pulled, 'the rectangle is drawn while the mouse is down').not.toBeNull();
    expect(pulled!.x).toBeCloseTo(camera.x + from.x / camera.zoom, 5);
    expect(pulled!.y).toBeCloseTo(camera.y + from.y / camera.zoom, 5);
    expect(pulled!.width).toBeCloseTo((to.x - from.x) / camera.zoom, 5);
    expect(pulled!.height).toBeCloseTo((to.y - from.y) / camera.zoom, 5);
    // And it is drawn on the screen at the corners the mouse went through, whatever the board
    // calls the space between them.
    const painted = await page.locator('[data-testid="marquee"]').boundingBox();
    expect(painted!.x).toBeCloseTo(from.x, 0);
    expect(painted!.width).toBeCloseTo(to.x - from.x, 0);
    // Nothing is selected until the mouse lets go: a person drawing a box is not selecting the
    // board's contents a dozen times on the way.
    expect(await selectedIds(page)).toEqual([]);
  });

  // The note the box enclosed, and only that one.
  expect(await selectedIds(page)).toEqual([inside]);
  expect(await objectInteraction(page, inside)).toBe('selected');
  expect(await objectInteraction(page, half)).toBe('unselected');
  expect(await objectInteraction(page, elsewhere)).toBe('unselected');
  // The rectangle went away with the mouse; it was never a thing on the board.
  expect(await marqueeWorld(page)).toBeNull();
  // One note is a selection too small for a bar.
  expect(await selectionBarCount(page)).toBeNull();
  // Pulling a rectangle is a selection, not a journey: the board did not move under it.
  expect(await readCamera(page)).toEqual(cameraBefore);

  // The bar belongs to the selection, so it shows up the moment the selection is big enough:
  // Shift-click adds a second note and the count arrives.
  await shiftClickObject(page, half);
  expect(await expectSelectionCount(page, 2)).toBe('2 selected');
  expect(await selectionOverlay(page).isVisible()).toBe(true);
  // And taking one out again, by Shift-clicking it, leaves the other where it was.
  await shiftClickObject(page, inside);
  expect(await selectedIds(page)).toEqual([half]);
  expect(await selectionBarCount(page)).toBeNull();
});

test('TC-32 at 50 % zoom the same box still takes what is visually inside it', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { zoom: 0.5 });

  const [near, far] = present(
    await createNotesAt(page, [
      { x: 400, y: 300 },
      { x: 800, y: 300 },
    ]),
  ) as [string, string];
  await clickEmptySpace(page, { x: 100, y: 700 });

  // At 50 % a note is 100 pixels across; the box below encloses the first and stops short of the
  // second. It is chosen in screen pixels because screen pixels are what the mouse pulls.
  const from = { x: 300, y: 200 };
  const to = { x: 500, y: 450 };
  await marqueeDrag(page, from, to, async () => {
    // Half the size on screen, twice the ground to cover: 200 pixels at 50 % are 400 units of board.
    const pulled = await marqueeWorld(page);
    expect(pulled!.width).toBeCloseTo((to.x - from.x) / 0.5, 5);
  });

  expect(await selectedIds(page)).toEqual([near]);
  expect(await objectInteraction(page, far)).toBe('unselected');
});

test('TC-33 six notes selected: a drag moves all six above a seventh, a handle scales them all', async ({
  page,
}) => {
  await openBoard(page);
  // 50 % zoom, because six notes and the box around them need to fit on one screen — and because
  // a group transform that only works at 100 % would be a group transform with a bug in it.
  await setCamera(page, { zoom: 0.5 });
  const zoom = (await readCamera(page)).zoom;
  /** Screen pixels are this many world units at the zoom this test is drawn at. */
  const units = (pixels: number): number => pixels / zoom;

  // Two rows of three, with a seventh note beside the bottom-right one — the one the group is
  // going to have to pass over. Made last, so it starts out on top of everything.
  const six = present(
    await createNotesAt(page, CLUSTER_YS.flatMap((y) => CLUSTER_XS.map((x) => ({ x, y })))),
  ) as [string, string, string, string, string, string];
  const [seventh] = present(await createNotesAt(page, [{ x: 700, y: 350 }])) as [string];
  await clickEmptySpace(page, { x: 110, y: 700 });
  expect(await selectedIds(page)).toEqual([]);

  await selectObjects(page, six);
  expect(await expectSelectionCount(page, 6)).toBe('6 selected');
  expect(await handleNames(page)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  expect(await selectionOverlay(page).getAttribute('data-resizable')).toBe('true');

  // --- moving the group: one note under the mouse, six notes answering
  const before = new Map<string, WorldRect & { z: number }>();
  for (const id of [...six, seventh]) before.set(id, await objectWorld(page, id));
  // The seventh note is on top of the board, which is what makes the next assertion mean anything.
  for (const id of six) expect(before.get(id)!.z).toBeLessThan(before.get(seventh)!.z);

  // 150 pixels at 50 % is the 300 units the design asks for.
  await dragObjectAndSettle(page, six[0] as string, 150, 0);
  for (const id of six) {
    const was = before.get(id)!;
    const now = await objectWorld(page, id);
    expect(now.x, `note ${id} travelled with the group`).toBeCloseTo(was.x + units(150), 5);
    expect(now.y, `note ${id} did not drift`).toBeCloseTo(was.y, 5);
    expect(now.width, `note ${id} is the same note it was`).toBeCloseTo(was.width, 5);
  }
  const seventhNow = await objectWorld(page, seventh);
  expect(seventhNow.x).toBeCloseTo(before.get(seventh)!.x, 5);
  expect(seventhNow.y).toBeCloseTo(before.get(seventh)!.y, 5);

  // And the group is now above the note it was dragged over, without losing the order it had among
  // itself: the person picked these six up, so these six are on top.
  const lifted = await Promise.all(six.map((id) => objectWorld(page, id)));
  for (const note of lifted) expect(note.z).toBeGreaterThan(seventhNow.z);
  const orderBefore = [...six].sort((a, b) => before.get(a)!.z - before.get(b)!.z);
  const orderAfter = [...six].sort((a, b) => {
    const za = lifted[six.indexOf(a)]!.z;
    const zb = lifted[six.indexOf(b)]!.z;
    return za - zb;
  });
  expect(orderAfter).toEqual(orderBefore);

  // The box around the six, and the gaps it is made of.
  const box = await waitForOverlayAtRest(page);
  expect(box, 'the selection has a box').not.toBeNull();
  const first = lifted[0]!;
  const gaps = {
    x: (await objectWorld(page, six[1] as string)).x - (first.x + first.width),
    y: (await objectWorld(page, six[3] as string)).y - (first.y + first.height),
  };
  expect(gaps.x).toBeGreaterThan(0);
  expect(gaps.y).toBeGreaterThan(0);

  // --- growing them all: the handle is pulled out, and every note answers in the same proportion
  const handle = await handleScreen(page, 'se');
  await dragFromPoint(page, handle, 100, 50);
  const grown = await waitForObjectAtRest(page, six[0] as string);
  const scale = grown.width / first.width;
  expect(scale, 'the drag was outwards').toBeGreaterThan(1);

  const sizes = new Set<string>();
  for (const id of six) {
    const note = await objectWorld(page, id);
    sizes.add(`${note.width.toFixed(3)}x${note.height.toFixed(3)}`);
    expect(note.width, `note ${id} grew with the group`).toBeCloseTo(first.width * scale, 3);
    expect(note.height, `note ${id} stayed square`).toBeCloseTo(note.width, 3);
    expect(note.x, `note ${id} stayed inside the box`).toBeGreaterThanOrEqual(box!.x - 1);
  }
  expect(sizes.size, 'all six notes are the same size').toBe(1);
  // The space between them is part of the selection too: a group that scaled its notes and not its
  // gaps would arrive as six notes in a heap.
  const rightNeighbour = await objectWorld(page, six[1] as string);
  const lowerNeighbour = await objectWorld(page, six[3] as string);
  expect(rightNeighbour.x - (grown.x + grown.width)).toBeCloseTo(gaps.x * scale, 3);
  expect(lowerNeighbour.y - (grown.y + grown.height)).toBeCloseTo(gaps.y * scale, 3);
  const grownBox = await overlayWorld(page);
  expect(grownBox!.width).toBeCloseTo(box!.width * scale, 3);
  expect(grownBox!.height).toBeCloseTo(box!.height * scale, 3);

  // --- shrinking them all: the handle is dragged back past the far corner, and they stop at the
  // smallest size their own type allows instead of turning into nothing.
  const outer = await handleScreen(page, 'se');
  const corner = await handleScreen(page, 'nw');
  await dragFromPoint(page, outer, corner.x - outer.x + 20, corner.y - outer.y + 20);
  const shrunk = await waitForObjectAtRest(page, six[0] as string);
  const shrink = shrunk.width / first.width;
  for (const id of six) {
    const note = await objectWorld(page, id);
    expect(note.width, `note ${id} is not smaller than its type allows`).toBeGreaterThanOrEqual(
      STICKY_MIN_SIZE_WORLD - 1e-6,
    );
    expect(note.width, `note ${id} stopped at the minimum`).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
    expect(note.height, `note ${id} is still square`).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
  }
  const shrunkNeighbour = await objectWorld(page, six[1] as string);
  expect(shrunkNeighbour.x - (shrunk.x + shrunk.width)).toBeCloseTo(gaps.x * shrink, 2);
  const shrunkBox = await overlayWorld(page);
  expect(shrunkBox!.width).toBeCloseTo(box!.width * shrink, 2);

  // Still seven notes on the board, still the same six of them selected, and the board itself never
  // moved during any of this: a group transform is an edit, not a journey.
  expect(await expectObjectCount(page, 7)).toHaveLength(7);
  expect(await selectedIds(page)).toHaveLength(6);
  expect(await selectionBarCount(page)).toBe(6);
  expect(await objectInteraction(page, seventh)).toBe('unselected');
  expect((await readCamera(page)).zoom).toBeCloseTo(zoom, 6);
});

test('TC-34 arrow keys move the selection, never the page or the board; Delete takes the lot', async ({
  page,
}) => {
  await openBoard(page);

  const six = present(
    await createNotesAt(page, [
      { x: 390, y: 220 },
      { x: 690, y: 220 },
      { x: 990, y: 220 },
      { x: 390, y: 520 },
      { x: 690, y: 520 },
      { x: 990, y: 520 },
    ]),
  ) as [string, string, string, string, string, string];
  // A bystander, in nobody's selection, to prove a keystroke moves what was asked about and
  // nothing else.
  const [bystander] = present(await createNotesAt(page, [{ x: 1100, y: 700 }])) as [string];
  await clickEmptySpace(page, { x: 150, y: 700 });

  await selectObjects(page, six);
  expect(await expectSelectionCount(page, 6)).toBe('6 selected');

  const cameraBefore = await readCamera(page);
  const scrollBefore = await pageScroll(page);
  const start = new Map<string, WorldRect>();
  for (const id of [...six, bystander]) start.set(id, await objectWorld(page, id));

  // Three presses: one unit each, because an arrow key is a nudge and not a drag.
  await nudgeKeys(page, 'ArrowRight', 3);
  for (const id of six) {
    const now = await objectWorld(page, id);
    expect(now.x, `note ${id} moved three units right`).toBeCloseTo(start.get(id)!.x + 3, 6);
    expect(now.y, `note ${id} did not fall`).toBeCloseTo(start.get(id)!.y, 6);
  }
  // Shift is the long step.
  await nudgeKeys(page, 'ArrowRight', 1, true);
  for (const id of six) {
    expect((await objectWorld(page, id)).x).toBeCloseTo(start.get(id)!.x + 13, 6);
  }
  await nudgeKeys(page, 'ArrowDown', 2);
  for (const id of six) {
    expect((await objectWorld(page, id)).y).toBeCloseTo(start.get(id)!.y + 2, 6);
  }

  // What did *not* move: the note nobody selected, the board, and the page itself. A board that let
  // arrow keys scroll the document would look like it worked while doing something else.
  const untouched = await objectWorld(page, bystander);
  expect(untouched.x).toBeCloseTo(start.get(bystander)!.x, 6);
  expect(untouched.y).toBeCloseTo(start.get(bystander)!.y, 6);
  expect(await readCamera(page)).toEqual(cameraBefore);
  expect(await pageScroll(page)).toEqual(scrollBefore);

  // The whole selection is still the whole selection after all that keyboard work.
  expect(await selectedIds(page)).toHaveLength(6);

  // Delete removes everything that was selected, in one answer.
  await page.keyboard.press('Delete');
  const left = await expectObjectCount(page, 1);
  expect(left).toEqual([bystander]);
  expect(await selectionBarCount(page)).toBeNull();
  expect(await selectionOverlay(page).count()).toBe(0);
  expect(await selectedIds(page)).toEqual([]);

  // And the keyboard route back in: select all, delete, empty board.
  await selectAllKeys(page);
  expect(await selectedIds(page)).toEqual([bystander]);
  await page.keyboard.press('Delete');
  await expectObjectCount(page, 0);
});

test('TC-36 five people each move a different selection at the same time', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  resetLatencySamples();
  const boardId = newBoard();
  const people = await openParticipants(browser, [...NAMES].slice(0, MAX_CONCURRENT_EDITORS), boardId);
  expect(people.length).toBe(MAX_CONCURRENT_EDITORS);

  // Ten notes, five pairs. The board is made once, by the first person, and everybody is looking at
  // it before anybody starts dragging. At 50 % zoom, so five pairs and the room to drag them all
  // fit in one window.
  const maker = people[0] as Participant;
  // Everyone is at 50 % before anything is made. The camera is each person's own business, but the
  // notes below are placed by where they are *seen*, so every window has to be at the same scale for
  // "click the second note" to mean the same click in all five.
  for (const person of people) await setCamera(person.page, { zoom: 0.5 });
  const zoom = (await readCamera(maker.page)).zoom;
  // The columns start clear of the board tools, which sit on the left edge of the window: a note
  // cannot be made underneath a button, and a test that tries learns about the interface rather than
  // about selection.
  const spots = [200, 350, 500, 650, 800].flatMap((x) => [200, 400].map((y) => ({ x, y })));
  const ids = present(await createNotesAt(maker.page, spots));
  expect(ids).toHaveLength(10);
  await expectChangeToArrive(everyoneElse(people, maker), 'all ten notes', (other) =>
    noteCount(other.page).then((seen) => seen === 10),
  );

  // Each person selects a pair of their own — before anybody drags, so that a neighbour's note
  // passing underneath is not mistaken for something to pick up.
  const pairs = people.map(
    (_, index) => present(ids.slice(index * 2, index * 2 + 2)) as [string, string],
  );
  for (const [index, person] of people.entries()) {
    await selectObjects(person.page, pairs[index] as readonly string[]);
    await expectSelectionCount(person.page, 2);
  }

  // Where everything starts, from the board's own point of view.
  const start = new Map<string, WorldRect>();
  for (const id of ids) start.set(id, await objectWorld(maker.page, id));

  // All five drag at once, each their own pair, each a different distance. The board has to keep all
  // ten notes straight while five pointers are moving over it.
  const drags = people.map((person, index) => ({
    person,
    pair: pairs[index] as string[],
    dx: 30 + index * 15,
    dy: 20 + index * 8,
  }));
  const ownerOf = new Map<string, { name: string; dx: number; dy: number }>();
  for (const { person, pair, dx, dy } of drags) {
    for (const id of pair) ownerOf.set(id, { name: person.name, dx, dy });
  }
  expect(ownerOf.size).toBe(10);

  await Promise.all(
    drags.map(({ person, pair, dx, dy }) => dragObjectAndSettle(person.page, pair[0] as string, dx, dy)),
  );

  // Five people, one board: first let the five screens agree, note for note and place for place,
  // and only then ask what they agree about. Reading a neighbour's screen a moment after their
  // pointer let go would be reading the network, not the board.
  await expectSameBoard(people, 'five people moved five selections at once', 30_000);

  // Every note ended up exactly where the person who owns it left it, and that is true on every
  // screen: a neighbour's note passing underneath was not picked up by somebody else's drag, and
  // nobody's group reached into somebody else's pair.
  for (const person of people) {
    for (const id of ids) {
      const move = ownerOf.get(id)!;
      const place = await objectWorld(person.page, id);
      expect(
        place.x,
        `${id} is where ${move.name} left it, on ${person.name}’s screen`,
      ).toBeCloseTo(start.get(id)!.x + move.dx / zoom, 5);
      expect(place.y).toBeCloseTo(start.get(id)!.y + move.dy / zoom, 5);
    }
  }

  // Each person is still holding the pair they picked up: somebody else's drag is not a reason to
  // let go.
  for (const [index, person] of people.entries()) {
    expect(
      await selectionBarCount(person.page),
      `${person.name} is still holding two notes`,
    ).toBe(2);
    expect(await selectedIds(person.page).then((held) => [...held].sort())).toEqual(
      [...(pairs[index] as string[])].sort(),
    );
  }

  // One group move, timed: when one person picks up two notes and drags them, the other four see
  // both of them arrive, as one change and not as two notes shuffling about separately.
  const mover = people[0] as Participant;
  const timed = pairs[0] as [string, string];
  await dragObjectAndSettle(mover.page, timed[0], 60, 40);
  const landed = await Promise.all(timed.map((id) => objectWorld(mover.page, id)));
  await expectChangeToArrive(everyoneElse(people, mover), 'a group move of two notes', (other) =>
    Promise.all(timed.map((id) => objectWorld(other.page, id))).then((seen) =>
      seen.every((place, index) =>
        Math.abs(place.x - (landed[index] as WorldRect).x) < 1 &&
        Math.abs(place.y - (landed[index] as WorldRect).y) < 1,
      ),
    ),
  );

  console.info(`${latencyReport(latencySamples())} while five people dragged at the same time`);
  expectNoConsoleErrors(people);
  await writeLatencyReport(testInfo, 'tc-36-concurrent-selections');
  await closeParticipants(people);
});
