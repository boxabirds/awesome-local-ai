import { beforeEach, describe, expect, it } from 'vitest';
import { flushFrames } from './helpers';
import {
  cancelDrag,
  centreOnScreen,
  clickAt,
  moveTo,
  mountSticky,
  press,
  pressKey,
  release,
  shiftPress,
  shiftDrag,
  type MountedSticky,
} from './helpers/sticky';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';

/**
 * The marquee (TC-20 to TC-22): the rectangle dragged across empty board space, and what it does
 * to the selection.
 *
 * The rule being tested is the one a person cannot see the inside of: an object joins the
 * selection only when the box holds it *completely*. So the three notes are arranged to make that
 * rule the only thing that can tell the answers apart - one inside the box, one that the box cuts
 * in half, one nowhere near it - and the box is dragged in world units through `board.screenOf`,
 * so the test says where the box is on the board rather than guessing at pixels.
 *
 * The second thing tested is what an interrupted marquee must not do: change anything. A drag that
 * was cancelled is a drag that did not happen.
 */

const A = { x: -400, y: -100 };
const B = { x: -100, y: -100 };
const C = { x: 300, y: 200 };

/** A box that holds B completely, cuts A in half, and never reaches C. World units. */
const BOX_FROM = { x: -420, y: -250 };
const BOX_TO = { x: 50, y: 50 };

/** Empty board space a plain drag can start from without touching a note. */
const EMPTY = { x: -560, y: -300 };

let ids: string[] = [];

function seedThree(board: MountedSticky): void {
  for (const at of [A, B, C]) {
    ids.push(createSticky(board.doc, at));
  }
}

function select(board: MountedSticky, index: number): void {
  clickAt(board.box(index), centreOnScreen(board, board.object(ids[index]!)));
}

/** Shift + press a note into the selection, leaving what was already selected alone. */
function addToSelection(board: MountedSticky, index: number): void {
  shiftPress(board.box(index), centreOnScreen(board, board.object(ids[index]!)));
}

function selectedIds(board: MountedSticky): string[] {
  return board.outlinedIds();
}

describe('sel.marquee_ui: shift and drag (TC-20)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    ids = [];
    board = await mountSticky();
    seedThree(board);
    await flushFrames();
  });

  it('TC-20: the box adds what it holds completely, to what was already selected', async () => {
    select(board, 0);
    await flushFrames();
    expect(selectedIds(board)).toEqual([ids[0]]);

    await shiftDrag(board, board.screenOf(BOX_FROM), board.screenOf(BOX_TO));

    // B is inside the box; A is cut by its left edge and so was already selected, and stays;
    // C is nowhere near it.
    expect(selectedIds(board).sort()).toEqual([ids[0], ids[1]].sort());
    expect(selectedIds(board)).not.toContain(ids[2]);
    expect(board.barText()).toBe('2 selected');
    // Selection, not movement: nothing about the objects themselves changed.
    expect(snapshot(board.doc).map((object) => [object.x, object.y])).toEqual([
      [A.x - 100, A.y - 100],
      [B.x - 100, B.y - 100],
      [C.x - 100, C.y - 100],
    ]);
  });

  it('TC-20b: the rectangle is drawn while the pointer is down, in world units', async () => {
    shiftPress(board.board, board.screenOf(BOX_FROM));
    await flushFrames();
    expect(board.board.dataset.marquee).toBe('true');
    const drawn = board.marqueeOrNull();
    expect(drawn).not.toBeNull();

    moveTo(board.board, board.screenOf(BOX_TO));
    await flushFrames();
    const box = board.marqueeOrNull()!;
    expect(Number(box.dataset.width)).toBeCloseTo(BOX_TO.x - BOX_FROM.x, 0);
    expect(Number(box.dataset.height)).toBeCloseTo(BOX_TO.y - BOX_FROM.y, 0);
    expect(box.style.left).toBe(`${BOX_FROM.x}px`);
    expect(box.style.top).toBe(`${BOX_FROM.y}px`);
    // It is feedback, not content: nobody reading the board should have it read out.
    expect(box.getAttribute('aria-hidden')).toBe('true');

    release(board.board, board.screenOf(BOX_TO));
    await flushFrames();
    expect(board.marqueeOrNull()).toBeNull();
    expect(board.board.dataset.marquee).toBe('false');
  });

  it('TC-20c: a box the wrong way round is the same box', async () => {
    // Dragged from the bottom-right to the top-left, which is how half of all marquees happen.
    await shiftDrag(board, board.screenOf(BOX_TO), board.screenOf(BOX_FROM));
    expect(selectedIds(board)).toEqual([ids[1]]);
  });

  it('TC-20d: a box that catches nothing leaves the selection exactly as it was', async () => {
    select(board, 0);
    addToSelection(board, 2);
    await flushFrames();
    const before = selectedIds(board).slice().sort();

    await shiftDrag(
      board,
      board.screenOf({ x: -580, y: -380 }),
      board.screenOf({ x: -540, y: -340 }),
    );

    expect(selectedIds(board).slice().sort()).toEqual(before);
    expect(board.barText()).toBe('2 selected');
  });

  it('TC-20e: a marquee adds, where a press on one object replaces', async () => {
    select(board, 2);
    await flushFrames();
    // A box over the first note only: the note that was selected is still selected after it.
    await shiftDrag(
      board,
      board.screenOf({ x: A.x - 120, y: A.y - 120 }),
      board.screenOf({ x: A.x + 120, y: A.y + 120 }),
    );
    expect(selectedIds(board).sort()).toEqual([ids[0], ids[2]].sort());
  });

  it('TC-20f: the box is measured on the board, so zooming changes what it holds', async () => {
    // Zoomed out, the same screen distance covers twice as much board - which is the reason the
    // box is kept in world units rather than in pixels.
    const screenFrom = board.screenOf(BOX_FROM);
    const screenTo = board.screenOf(BOX_TO);
    await shiftDrag(board, screenFrom, screenTo);
    expect(selectedIds(board)).toEqual([ids[1]]);
  });

  it('TC-20g: shift + press on a note takes it out of the selection instead of dragging', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    expect(board.barText()).toBe('2 selected');

    // Shift + press the first note again: it leaves the selection, and no drag follows it.
    shiftPress(board.box(0), centreOnScreen(board, board.object(ids[0]!)));
    await flushFrames();
    const position = snapshot(board.doc).find((object) => object.id === ids[0])!;
    release(board.box(0), centreOnScreen(board, position));
    await flushFrames();

    expect(selectedIds(board)).toEqual([ids[1]]);
    expect(snapshot(board.doc).find((object) => object.id === ids[0])!.x).toBe(position.x);
  });
});

describe('sel.marquee_ui: an ordinary drag is not a marquee (TC-21)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    ids = [];
    board = await mountSticky();
    seedThree(board);
    await flushFrames();
  });

  it('TC-21: a drag without Shift pans the board and draws no rectangle', async () => {
    select(board, 0);
    await flushFrames();
    const before = board.camera();

    press(board.board, board.screenOf(EMPTY));
    await flushFrames();
    expect(board.board.dataset.marquee).toBe('false');
    expect(board.board.dataset.panning).toBe('true');
    const to = { x: board.screenOf(EMPTY).x + 200, y: board.screenOf(EMPTY).y + 100 };
    moveTo(board.board, to);
    await flushFrames();
    expect(board.marqueeOrNull()).toBeNull();
    expect(board.board.dataset.marquee).toBe('false');
    expect(board.camera()).not.toEqual(before);
    release(board.board, to);
    await flushFrames();

    // The board moved, and the selection is none the worse for it.
    expect(board.camera()).not.toEqual(before);
    expect(selectedIds(board)).toEqual([ids[0]]);
  });

  it('TC-21b: a press on empty space that never travelled is a click, not a rectangle', async () => {
    select(board, 0);
    await flushFrames();

    clickAt(board.board, board.screenOf(EMPTY));
    await flushFrames();

    expect(board.marqueeOrNull()).toBeNull();
    expect(board.board.dataset.marquee).toBe('false');
    expect(selectedIds(board)).toEqual([]);
    expect(board.camera()).toEqual(board.camera());
  });

  it('TC-21c: two pixels of shift + drag is still short enough to be a click', async () => {
    // The threshold is about not moving the board by accident; a rectangle of two pixels selects
    // nothing, which is the same answer either way.
    const from = board.screenOf(EMPTY);
    shiftPress(board.board, from);
    moveTo(board.board, { x: from.x + DRAG_THRESHOLD_PX - 1, y: from.y });
    release(board.board, { x: from.x + DRAG_THRESHOLD_PX - 1, y: from.y });
    await flushFrames();

    expect(board.marqueeOrNull()).toBeNull();
    expect(selectedIds(board)).toEqual([]);
  });

  it('TC-21d: shift + drag never pans, however far it goes', async () => {
    const before = board.camera();
    await shiftDrag(board, board.screenOf(EMPTY), {
      x: board.screenOf(EMPTY).x + 400,
      y: board.screenOf(EMPTY).y + 300,
    });
    expect(board.camera()).toEqual(before);
  });
});

describe('sel.marquee_ui: a rectangle that gets interrupted (TC-22)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    ids = [];
    board = await mountSticky();
    seedThree(board);
    await flushFrames();
  });

  it('TC-22: pointercancel mid-drag changes nothing about the selection', async () => {
    select(board, 0);
    await flushFrames();
    const before = selectedIds(board);

    const from = board.screenOf(BOX_FROM);
    const mid = board.screenOf(BOX_TO);
    shiftPress(board.board, from);
    moveTo(board.board, mid);
    await flushFrames();
    expect(board.marqueeOrNull()).not.toBeNull();

    cancelDrag(board.board, mid);
    await flushFrames();

    expect(board.marqueeOrNull()).toBeNull();
    expect(board.board.dataset.marquee).toBe('false');
    expect(selectedIds(board)).toEqual(before);
    expect(board.barOrNull()).toBeNull();
  });

  it('TC-22b: the pointer going up after a cancel does not select anything after all', async () => {
    select(board, 0);
    await flushFrames();
    const before = selectedIds(board);

    const from = board.screenOf(BOX_FROM);
    const mid = board.screenOf(BOX_TO);
    shiftPress(board.board, from);
    moveTo(board.board, mid);
    cancelDrag(board.board, mid);
    // The browser lifts the pointer some time later, over the same stretch of board.
    release(board.board, mid);
    await flushFrames();

    expect(selectedIds(board)).toEqual(before);
    expect(board.marqueeOrNull()).toBeNull();
  });

  it('TC-22c: Escape stops the rectangle and keeps what was selected before it', async () => {
    select(board, 0);
    await flushFrames();

    const from = board.screenOf(BOX_FROM);
    const mid = board.screenOf(BOX_TO);
    shiftPress(board.board, from);
    moveTo(board.board, mid);
    await flushFrames();
    expect(board.marqueeOrNull()).not.toBeNull();

    pressKey('Escape');
    await flushFrames();

    expect(board.marqueeOrNull()).toBeNull();
    expect(selectedIds(board)).toEqual([ids[0]]);
    // The box never completed, so the note it was cutting in half never joined.
    expect(selectedIds(board)).not.toContain(ids[1]);
  });

  it('TC-22d: Escape with no rectangle away is the ordinary Escape', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    expect(board.barText()).toBe('2 selected');

    pressKey('Escape');
    await flushFrames();

    expect(selectedIds(board)).toEqual([]);
    expect(board.barOrNull()).toBeNull();
  });

  it('TC-22e: a cancel with nothing selected is not an error and writes nothing', async () => {
    const before = JSON.stringify(snapshot(board.doc));
    const from = board.screenOf(BOX_FROM);
    shiftPress(board.board, from);
    moveTo(board.board, board.screenOf(BOX_TO));
    cancelDrag(board.board, board.screenOf(BOX_TO));
    await flushFrames();

    expect(selectedIds(board)).toEqual([]);
    expect(JSON.stringify(snapshot(board.doc))).toBe(before);
  });
});
