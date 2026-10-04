/**
 * Selecting a group of notes and treating them as one thing, in a real browser.
 *
 * Four of this story's workflows need a browser rather than a simulated one, and each needs it for a
 * different reason:
 *
 * - A box drawn round things selects what is inside it, and "inside" is decided by where the notes
 *   are drawn at whatever zoom the board happens to be at. jsdom draws nothing, so a jsdom test of
 *   containment only checks the arithmetic against itself.
 * - A resize handle has to be a shape a mouse can hit. The board divides its size by the zoom for
 *   exactly that reason, which is a claim about laid-out pixels and nothing else.
 * - "The notes I dragged came to the front" is a claim about which pixels the browser painted last.
 *   The document holds a number per note, and a number can be perfectly correct while the note it
 *   describes is still drawn underneath something else.
 * - Delete and the arrow keys are asserted not to scroll the page or pan the board, which is a claim
 *   about what a browser does with a keystroke when nobody stops it.
 *
 * And one workflow is about what a room full of people gets away with at the same time: everyone
 * boxes their own corner of the board and drags it, and every one of them ends up looking at the same
 * board. That is the part of the design that writes object positions as absolute numbers instead of
 * deltas, and it is only worth testing where the network is real.
 */

import { expect, test } from '@playwright/test';
import {
  HANDLE_SIZE_PX,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { openBoard, readCamera, setCamera, settle } from './helpers/board';
import {
  Cast,
  boardJson,
  faces,
  logScenario,
  waitForSameBoard,
  type NoteFace,
} from './helpers/participants';
import {
  barText,
  boundsOfSelection,
  createNoteAt,
  createNotesAt,
  dragHandleBy,
  dragObjectBy,
  handleSizeOnScreen,
  marquee,
  marqueeBox,
  marqueeDrag,
  near,
  outlineIds,
  outlineOf,
  pageScroll,
  paintTopId,
  placeOf,
  places,
  pressBoardKey,
  putThePenDown,
  resizeHandles,
  screenOf,
  selectObject,
  shiftClickObject,
  waitForBar,
  waitForOutlines,
  type Place,
} from './helpers/selection';
import {
  cameraAround,
  editor,
  noteById,
  notes,
  stopEditing,
  textById,
  toolbarById,
} from './helpers/sticky';

/* ------------------------------------------------------------------------- one cluster */

/** A three-by-two cluster: six notes, a hundred units between neighbours. */
const CLUSTER = [
  { x: -300, y: -150 },
  { x: 0, y: -150 },
  { x: 300, y: -150 },
  { x: -300, y: 150 },
  { x: 0, y: 150 },
  { x: 300, y: 150 },
];

/** A note laid across the middle of the cluster, and left where it is. */
const IN_THE_WAY = { x: 200, y: 0 };

/**
 * The view the cluster is worked on in.
 *
 * The cluster is 800 world units wide, the drag that moves it is 300, and the resize that follows
 * takes the whole selection to one and a half times its size: fifteen hundred world units from the
 * first press to the last, which is more than one screen holds at zoom 1. So the board is looked at
 * from further out, which is also what somebody does with a cluster that will not fit on the screen
 * in the first place. Positions are still asserted in world units, read off the elements the board
 * draws, so nothing is rounded in the browser's favour.
 */
const WIDE = { x: -1200, y: -700, zoom: 0.5 };

/** How many handles a selection of things that can be resized is drawn with. */
const HANDLE_COUNT = 8;

/** The gap between neighbours in the cluster, in world units, before anything is scaled. */
const GAP_WORLD = 100;

/** What the cluster measures, and GROW the scale its corner is dragged to. */
const CLUSTER_BOX = { width: 800, height: 500 };
const GROW = 1.5;

/**
 * A scale smaller than the floor allows, for the drag that asks for the impossible.
 *
 * Each note in the scaled cluster is three hundred units across and may not go under fifty, so the
 * least the board will accept is a sixth. This asks for slightly under that: the notes have to stop
 * at the floor rather than carry on past it, and they have to stop together - which is why the
 * clamping is done once for the selection rather than note by note.
 */
const BELOW_THE_FLOOR = (STICKY_MIN_SIZE_WORLD / (STICKY_SIZE_WORLD * GROW)) * 0.96;

/**
 * The pixel where the cluster, once moved right, lies over the note that was already there: inside
 * both of them, and nowhere near an edge of either.
 *
 * It is asked of the browser twice - once before the drag, when the note made last is on top, and
 * once after, when the six that were dragged across it have to be on top instead.
 */
const ON_TOP_OF = { x: 250, y: -75 };

test.describe('reorganising a cluster (TC-32, TC-33, TC-34)', () => {
  test('TC-32: a box drawn round things selects the things fully inside it', async ({ page }) => {
    await openBoard(page);
    // Three notes in a row, a hundred units apart - all of them inside the one screen of board a
    // fresh board shows, because a double-click outside the window is a double-click on nothing. One
    // will end up inside the box, one cut in half by its edge, and one nowhere near it.
    const inside = await createNoteAt(page, { x: -300, y: 0 });
    const half = await createNoteAt(page, { x: 0, y: 0 });
    const outside = await createNoteAt(page, { x: 300, y: 0 });
    expect(await notes(page)).toHaveCount(3);

    // The note this page made last is the note it holds selected - making a note selects it - so the
    // pen goes down first. A box adds to what the board holds selected, and this first box is about
    // what the box itself holds.
    await putThePenDown(page);

    // The box is drawn from empty board space with Shift held, which is what tells the board that
    // this drag is a box rather than a pan.
    const camera = await readCamera(page);
    const box = { x: -450, y: -200, width: 450, height: 400 };
    const start = await screenOf(page, { x: box.x, y: box.y });
    const end = await screenOf(page, { x: box.x + box.width, y: box.y + box.height });

    await page.keyboard.down('Shift');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await settle(page);

    // While the mouse is down, the rectangle on the screen is the rectangle that was asked for. A
    // board that selected from a box of its own invention would be choosing things nobody enclosed,
    // and the only evidence of it would be notes somebody never touched.
    await expect(marquee(page), 'the box should be drawn while it is being dragged').toBeVisible();
    const drawn = await marqueeBox(page);
    near(drawn.x, box.x);
    near(drawn.y, box.y);
    near(drawn.width, box.width);
    near(drawn.height, box.height);

    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);

    // Only what the box fully covers was chosen. The note the edge of the box runs through is not
    // inside it, and neither is the one that was never near it.
    await waitForOutlines(page, [inside]);
    expect(await barText(page), 'one note is not a group').toBeNull();
    await expect(toolbarById(page, inside)).toBeVisible();

    // The box itself is gone once the mouse is up: it was a gesture, not an object left on the board.
    await expect(marquee(page)).toHaveCount(0);

    // And the view did not move. That is the other half of what Shift is for: a drag that draws a box
    // must not also pan the board, or the box would move somewhere else by the act of drawing it.
    expect(await readCamera(page)).toEqual(camera);

    // A box that covers two notes leaves both of them selected, and two is where the bar comes out.
    // The first note is still selected from the box before it: a box adds what it covers to what the
    // board already holds, which is what makes it possible to build a selection out of two boxes.
    await marqueeDrag(page, { x: -450, y: -200 }, { x: 150, y: 200 });
    await waitForBar(page, '2 selected');
    await waitForOutlines(page, [inside, half]);
    expect(
      await resizeHandles(page).count(),
      'a selection of notes that can be resized is drawn with handles',
    ).toBe(HANDLE_COUNT);
    expect(await outlineIds(page)).not.toContain(outside);

    // The same box, dragged the other way round - from its far corner to its near one - chooses the
    // same two things. The direction a rectangle is dragged in is not part of what it holds.
    await marqueeDrag(page, { x: 150, y: 200 }, { x: -450, y: -200 });
    await waitForOutlines(page, [inside, half]);

    // A box round clear board space adds nothing to the selection: there is nothing in it to add. It
    // is Escape that puts the selection down, and the bar goes with it.
    await marqueeDrag(page, { x: -620, y: -380 }, { x: -500, y: -280 });
    await waitForOutlines(page, [inside, half]);
    await pressBoardKey(page, 'Escape');
    await waitForOutlines(page, []);
    expect(await barText(page)).toBeNull();

    // Containment is decided in the world rather than in pixels: the same note drawn twice as big on
    // the screen is the same note, and a box round it still holds the same two hundred units.
    await setCamera(page, cameraAround({ x: -300, y: 0 }, 2));
    await marqueeDrag(page, { x: -450, y: -150 }, { x: -150, y: 150 });
    await waitForOutlines(page, [inside]);
    const drawn2 = await outlineOf(page, inside).boundingBox();
    expect(drawn2, 'the outline is drawn over the note it belongs to').not.toBeNull();
    near(drawn2!.width, STICKY_SIZE_WORLD * 2, 2);
  });

  test('TC-33: six notes move as one, come to the front, and scale from a corner', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, WIDE);

    // The cluster, and one more note laid across the middle of it afterwards - so that it starts on
    // top of the notes it is about to have dragged over it.
    const ids = await createNotesAt(page, CLUSTER);
    const bystander = await createNoteAt(page, IN_THE_WAY);
    expect(await paintTopId(page, ON_TOP_OF)).toBe(bystander);

    // Six selected: one press, then Shift and a press for each of the rest.
    await selectObject(page, ids[0]!);
    for (const id of ids.slice(1)) {
      await shiftClickObject(page, id);
    }
    await waitForBar(page, '6 selected');
    await waitForOutlines(page, ids);
    expect(await resizeHandles(page).count()).toBe(HANDLE_COUNT);

    // Handles are placed in screen space for a reason: eight pixels is eight pixels whatever the
    // zoom, which is what makes one something a mouse can find. This board is at half size, so a
    // handle measured in world units would be four pixels wide here and sixteen when somebody zoomed
    // in to nudge a corner - a square that changes size under the pointer is not a handle.
    const handle = await handleSizeOnScreen(page, 'se');
    expect(
      handle,
      `a handle stays about ${HANDLE_SIZE_PX} pixels on the screen at any zoom`,
    ).toBeGreaterThanOrEqual(HANDLE_SIZE_PX - 2);
    expect(handle).toBeLessThanOrEqual(HANDLE_SIZE_PX + 2);

    const before = await places(page);

    // Drag one of them three hundred units to the right. All six go the same distance: the drag is on
    // the selection, and the note that was pressed is not being moved out of it.
    await dragObjectBy(page, ids[4]!, { x: 300, y: 0 });
    const moved = await places(page);
    for (const id of ids) {
      near(moved.get(id)!.x, before.get(id)!.x + 300);
      near(moved.get(id)!.y, before.get(id)!.y);
      // A move moves. It does not resize, however far it goes.
      near(moved.get(id)!.width, STICKY_SIZE_WORLD, 0.01);
      near(moved.get(id)!.height, STICKY_SIZE_WORLD, 0.01);
    }

    // The note that was in the way stayed where it was, and is no longer on top of the notes that
    // were dragged across it. That is what the browser was asked about at that pixel before any of
    // this happened, and it is what it is asked again now: a selection that went behind the thing it
    // was dragged over would arrive looking like nothing had happened at all.
    near(moved.get(bystander)!.x, before.get(bystander)!.x);
    near(moved.get(bystander)!.y, before.get(bystander)!.y);
    expect(moved.get(bystander)!.z).toBe(before.get(bystander)!.z);
    expect(await paintTopId(page, ON_TOP_OF), 'the note now covering that pixel is the one dragged there').toBe(
      ids[1]!,
    );
    for (const id of ids) {
      expect(
        moved.get(id)!.z,
        'the whole selection is stacked above the note left behind',
      ).toBeGreaterThan(moved.get(bystander)!.z);
    }

    // Now scale the whole thing from a corner. The drag is half the box again in each direction, in
    // the proportion of the box itself, which is what a drag from the corner of a wide box is.
    const box = await boundsOfSelection(page);
    near(box.width, CLUSTER_BOX.width);
    near(box.height, CLUSTER_BOX.height);

    // The corner the drag pivots on, read back rather than assumed: the top-left of the selection as
    // it stands, after the move.
    const anchor = {
      x: Math.min(...ids.map((id) => moved.get(id)!.x)),
      y: Math.min(...ids.map((id) => moved.get(id)!.y)),
    };
    await dragHandleBy(page, 'se', {
      x: (GROW - 1) * box.width,
      y: (GROW - 1) * box.height,
    });

    const grown = await places(page);
    for (const id of ids) {
      const place = grown.get(id)!;
      const was = centre(moved.get(id)!);
      // Every note is now three hundred units across - and square, although the box it was scaled
      // from was eight hundred by five hundred: a sticky note keeps its shape, and scales by the one
      // axis the drag was along rather than by the two sides of the box separately.
      near(place.width, STICKY_SIZE_WORLD * GROW, 0.01);
      near(place.height, STICKY_SIZE_WORLD * GROW, 0.01);
      // Every note has moved away from the corner the drag was anchored to by the scale that drag
      // asked for. That is the whole of what "the layout scaled rather than shuffled" means: the
      // distances between notes are a hundred and fifty now because every distance from the anchor is.
      near(place.x + place.width / 2, anchor.x + (was.x - anchor.x) * GROW);
      near(place.y + place.height / 2, anchor.y + (was.y - anchor.y) * GROW);
    }
    // The gaps, said as gaps rather than as arithmetic: a hundred units between neighbours becomes a
    // hundred and fifty, sideways and down.
    near(gapX(grown.get(ids[1]!), grown.get(ids[2]!)), GAP_WORLD * GROW);
    near(gapY(grown.get(ids[0]!), grown.get(ids[3]!)), GAP_WORLD * GROW);

    const grownBox = await boundsOfSelection(page);
    near(grownBox.width, CLUSTER_BOX.width * GROW);
    near(grownBox.height, CLUSTER_BOX.height * GROW);

    // The note left behind took none of this: it was never in the selection, and nothing about
    // scaling the six says anything about it.
    near(grown.get(bystander)!.width, STICKY_SIZE_WORLD, 0.01);
    near(grown.get(bystander)!.x, moved.get(bystander)!.x);

    // Now drag the same corner inwards, past the point where the notes would be smaller than they are
    // allowed to be. They stop at the floor - all of them at the same place on it.
    const beforeShrink = await boundsOfSelection(page);
    near(beforeShrink.width, CLUSTER_BOX.width * GROW);
    await dragHandleBy(page, 'se', {
      x: (BELOW_THE_FLOOR - 1) * beforeShrink.width,
      y: (BELOW_THE_FLOOR - 1) * beforeShrink.height,
    });
    const stopped = await places(page);
    for (const id of ids) {
      near(stopped.get(id)!.width, STICKY_MIN_SIZE_WORLD, 0.01);
      near(stopped.get(id)!.height, STICKY_MIN_SIZE_WORLD, 0.01);
    }
    // The corner the drag pivoted on did not move, even though everything on the far side of it did:
    // the drag was from the far corner, and the near one is what the board holds still.
    near(stopped.get(ids[0]!)!.x, anchor.x);
    near(stopped.get(ids[0]!)!.y, anchor.y);

    // And through all of it the selection stayed six notes long, holding the six it was given.
    await waitForBar(page, '6 selected');
    await waitForOutlines(page, ids);
  });

  test('TC-34: arrow keys nudge the selection and Delete empties it, without disturbing the view', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, WIDE);

    // Six notes to work on and a seventh that belongs to nobody in this test, so that there is
    // something on the board for the keys to leave alone.
    const ids = await createNotesAt(page, CLUSTER);
    const bystander = await createNoteAt(page, IN_THE_WAY);

    // Six of the seven are selected: one press, then Shift and a press for the rest.
    await selectObject(page, ids[0]!);
    for (const id of ids.slice(1)) {
      await shiftClickObject(page, id);
    }
    await waitForBar(page, '6 selected');

    const camera = await readCamera(page);
    const scrolled = await pageScroll(page);
    expect(scrolled, 'the page starts out unscrolled').toEqual({ x: 0, y: 0 });
    const before = await places(page);

    // Three single nudges and one long one: what the arrow keys are for, which is moving a thing by a
    // known amount rather than by however far the mouse happened to travel.
    for (let press = 0; press < 3; press += 1) {
      await pressBoardKey(page, 'ArrowRight');
    }
    await pressBoardKey(page, 'ArrowRight', true);

    const nudged = await places(page);
    const expected = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (const id of ids) {
      near(nudged.get(id)!.x, before.get(id)!.x + expected, 0.01);
      near(nudged.get(id)!.y, before.get(id)!.y, 0.01);
      // A nudge moves; it does not resize.
      near(nudged.get(id)!.width, STICKY_SIZE_WORLD, 0.01);
    }
    // The note that was not in the selection took none of it, however many arrows were pressed.
    near(nudged.get(bystander)!.x, before.get(bystander)!.x, 0.01);

    // The arrow keys must not scroll the page, and must not pan the board.
    //
    // This board is one screen tall, so there is nothing for the page to scroll and the first
    // assertion cannot fail on its own - which is exactly why it is worth making: a stray keystroke
    // would be invisible here and noticeable on a page that had somewhere to go. The number is the
    // one that would have changed, and the second half is the same claim about the only thing on this
    // page that can be moved, which is the board's own view rather than the browser's.
    expect(await pageScroll(page), 'the arrow keys must not scroll the page').toEqual(scrolled);
    expect(
      await page.evaluate(() => ({
        top: document.documentElement.scrollTop,
        left: document.documentElement.scrollLeft,
      })),
    ).toEqual({ top: 0, left: 0 });
    expect(await readCamera(page), 'the arrow keys must not pan the board').toEqual(camera);

    // Delete takes the whole selection at once, and only the selection.
    await pressBoardKey(page, 'Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(noteById(page, bystander)).toBeVisible();
    expect(await barText(page), 'a selection of nothing is not a bar').toBeNull();
    expect(await outlineIds(page)).toEqual([]);

    // A board emptied with Delete is not damaged by being emptied: the note left behind can still be
    // selected and moved, and the keyboard is still the keyboard.
    await selectObject(page, bystander);
    await waitForOutlines(page, [bystander]);
    await pressBoardKey(page, 'ArrowDown');
    near((await placeOf(page, bystander)).y, before.get(bystander)!.y + NUDGE_STEP_WORLD, 0.01);
  });

  test('the keys that belong to the text stay in the text', async ({ page }) => {
    // A note that is being typed into is not a thing to nudge or delete: the arrow keys move the caret
    // and Backspace takes a character, because that is what the person is holding the keyboard for at
    // that moment. This is worth watching in a browser, where the caret is real - and where the same
    // keystroke has to do opposite things depending on whether a note is open, with the decision made
    // once and got right in both places.
    await openBoard(page);
    await setCamera(page, WIDE);
    const [first, second] = await createNotesAt(page, [CLUSTER[0]!, CLUSTER[1]!]);

    // Two notes in the selection, and the first one opened for typing.
    await selectObject(page, first!);
    await shiftClickObject(page, second!);
    await waitForBar(page, '2 selected');
    const before = await places(page);
    const middle = await screenOf(page, centre(before.get(first!)!));
    await page.mouse.dblclick(middle.x, middle.y);
    await expect(editor(page)).toBeVisible();

    // Keys that type, and keys that move a caret: "caret", two arrows left, one character back and
    // one forward. Two arrows left from the end of the word puts the caret in front of the "e", so
    // Backspace takes the "r" behind it and Delete takes the "e" in front of it - which is what
    // "the arrow keys move a caret and the delete keys type" looks like in practice.
    await page.keyboard.type('caret');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    expect(await editor(page).inputValue(), 'the caret moved, and the letters either side of it went').toBe(
      'cat',
    );

    // Neither note moved, and the selection is still the two it was - including the note nobody was
    // typing into, which is the one a keystroke aimed at an editor could have taken by mistake.
    const typing = await places(page);
    for (const id of [first!, second!]) {
      near(typing.get(id)!.x, before.get(id)!.x, 0.001);
      near(typing.get(id)!.y, before.get(id)!.y, 0.001);
    }
    await waitForBar(page, '2 selected');

    // Escape closes the editor with the text kept and the selection kept - so Delete after Escape is
    // a keystroke with nothing in the way of it, and it means the whole selection: both notes, the one
    // that was typed into and the one that was not.
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(2);
    expect((await textById(page, first!).innerText()).trim()).toBe('cat');
    await waitForBar(page, '2 selected');
    await pressBoardKey(page, 'Delete');
    await expect(notes(page)).toHaveCount(0);
    expect(await outlineIds(page)).toEqual([]);
  });
});

/** The centre of a note, in world units, from where it is drawn. */
function centre(place: Place): { x: number; y: number } {
  return { x: place.x + place.width / 2, y: place.y + place.height / 2 };
}

/** How far the right-hand note is away from the left-hand note's right edge. */
function gapX(left: Place | undefined, right: Place | undefined): number {
  const a = held(left);
  const b = held(right);
  return b.x - (a.x + a.width);
}

/** The same, downwards. */
function gapY(above: Place | undefined, below: Place | undefined): number {
  const a = held(above);
  const b = held(below);
  return b.y - (a.y + a.height);
}

/** A note's place, with a failure that says the note was not on the board at all. */
function held(place: Place | undefined): Place {
  expect(place, 'the note should be drawn on the board').toBeDefined();
  return place!;
}

/* -------------------------------------------------------------------- the whole room */

/** The people in the room: one name per person it holds. */
const ROOM = ['Alex', 'Sam', 'Riley', 'Jo', 'Ana'];

/**
 * The view everyone looks at: five rows of three notes, every row on the screen at once, with a
 * hundred units of clear board between one person's row and the next.
 *
 * The clear board is what makes the test say what it means. Each person draws their own box, and a
 * box that happened to reach over a neighbour's row would select the neighbour's notes as well -
 * which would turn a test about five people moving five selections into a test about five people
 * moving each other's, and would say so in a failure message that looked like a race.
 */
const ROOM_VIEW = { x: -1200, y: -800, zoom: 0.5 };

/** Where the notes of person `index` are made: a row of three. */
function rowOf(index: number): { x: number; y: number }[] {
  return [-300, 0, 300].map((x) => ({ x, y: -600 + index * 300 }));
}

/** The near corner of a box that holds exactly one row, and nobody else's. */
function rowBox(index: number): { x: number; y: number } {
  return { x: -450, y: -750 + index * 300 };
}

/** How wide and tall that box is. */
const ROW_BOX = { width: 900, height: 300 };

/**
 * How far each person drags their own row, in world units.
 *
 * Sideways, and a different distance for everybody: the test is about five people moving five
 * different selections over one board at the same moment, and about every one of them ending up
 * looking at the same board afterwards. Distances stay inside the hundred units of clear board
 * between the rows, so nobody's notes are ever drawn on anybody else's.
 */
const DRAGS = [60, -60, 120, -120, 30];

test.describe('a full room, everybody reorganising their own corner (TC-36)', () => {
  test('everybody moves a different selection at once, and everybody ends up at the same board', async ({
    browser,
  }) => {
    const names = ROOM.slice(0, MAX_CONCURRENT_EDITORS);
    const cast = await Cast.open(browser, ...names);
    const started = Date.now();
    try {
      // Everyone looks at the same wide view of the board, and makes their own row of three notes.
      await Promise.all(cast.people.map((person) => setCamera(person.page, ROOM_VIEW)));
      const rows = await Promise.all(
        cast.people.map((person, index) => createNotesAt(person.page, rowOf(index))),
      );
      await waitForSameBoard(cast.people);
      const notesBefore = JSON.parse(await boardJson(cast.people[0]!.page));
      expect(notesBefore).toHaveLength(names.length * 3);

      // Where everything is before anybody drags anything - read once, and every page already agrees.
      const shown = await Promise.all(cast.people.map((person) => faces(person.page)));
      const before = new Map<string, NoteFace>();
      for (const face of shown[0]!) {
        before.set(face.id, face);
      }
      for (const other of shown.slice(1)) {
        expect(other.map((face) => face.id)).toEqual([...before.keys()]);
      }

      // Everyone boxes their own row and drags it, at the same time. Nothing here is sequenced: each
      // person has their own mouse and their own part of the board, which is the situation the design
      // had in mind when it chose to write absolute positions rather than deltas.
      await Promise.all(
        cast.people.map(async (person, index) => {
          const corner = rowBox(index);
          await marqueeDrag(person.page, corner, {
            x: corner.x + ROW_BOX.width,
            y: corner.y + ROW_BOX.height,
          });
          await waitForBar(person.page, '3 selected');
          await dragObjectBy(person.page, rows[index]![0]!, { x: DRAGS[index]!, y: 0 });
        }),
      );

      // Every page ends up drawing the same board. That is the claim, and it is the one a delta would
      // fail: five people applying five different sets of deltas to one document, in an order nobody
      // controls, has no reason to arrive anywhere in particular.
      const settled = await waitForSameBoard(cast.people);
      expect(JSON.parse(settled)).toHaveLength(names.length * 3);

      for (const person of cast.people) {
        const index = cast.people.indexOf(person);
        const own = rows[index]!;
        const delta = DRAGS[index]!;

        // Each person's three notes are where that person dragged them, on their own screen and on
        // everybody else's alike.
        const held = new Set(own);
        const faces2 = await faces(person.page);
        for (const face of faces2.filter((note) => held.has(note.id))) {
          const was = before.get(face.id)!;
          near(face.x, was.x + delta, 0.01);
          near(face.y, was.y, 0.01);
        }
        expect(faces2.filter((face) => held.has(face.id))).toHaveLength(3);

        // Nobody borrowed anybody else's selection. Each screen holds its own three notes and shows
        // them as selected; nobody's screen shows anybody else's as anything.
        await waitForBar(person.page, '3 selected');
        const outlines = (await outlineIds(person.page)).slice().sort();
        expect(outlines).toEqual(own.slice().sort());
        for (const face of faces2) {
          expect(
            face.selected,
            `only the three notes ${person.name} boxed should look selected on ${person.name}'s screen`,
          ).toBe(held.has(face.id));
        }
      }

      // The five rows really did go five different distances: a board where everybody had moved the
      // same way would pass the assertions above by accident, and this is the one that says it could
      // not have.
      const everyone = await faces(cast.people[0]!.page);
      const spots = new Set(everyone.map((face) => `${Math.round(face.x)},${Math.round(face.y)}`));
      expect(spots.size, 'every note should have ended up somewhere of its own').toBe(names.length * 3);

      logScenario('a full room moving five selections at once', started);
    } finally {
      await cast.close();
    }
  });
});
