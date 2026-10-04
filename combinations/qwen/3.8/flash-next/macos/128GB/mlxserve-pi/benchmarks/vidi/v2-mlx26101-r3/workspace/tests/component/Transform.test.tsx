import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, act } from '@testing-library/react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { flushFrames } from './helpers';
import {
  cancelDrag,
  centreOnScreen,
  clickAt,
  mountSticky,
  moveTo,
  press,
  pressKey,
  release,
  shiftPress,
  testboxElements,
  type MountedSticky,
} from './helpers/sticky';
import { TESTBOX_MIN_SIZE, createTestbox } from '../fixtures/testbox';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  createSticky,
  deleteObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { rectContainsPoint } from '../../src/shared/geometry';
import {
  registerObjectType,
  type ObjectPointerEvent,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { useSelection, type MultiSelection } from '../../src/client/board/useSelection';
import {
  useTransformGesture,
  type TransformGesture,
} from '../../src/client/board/useTransformGesture';
import { forgetProviders, theProvider, type FakeWebsocketProvider } from './helpers/fake-provider';
import type { Camera } from '../../src/client/canvas/camera';

// The client's provider is stubbed so a close code can be handed to it: one test below asks what a
// drag does on a board that is not known to be a board, and that state is only reachable by being
// told the room could not read it.
vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/**
 * Moving and resizing (TC-23 to TC-26): one gesture, whatever is selected.
 *
 * The arithmetic is what these tests are really about, so the boxes are chosen to make it
 * unambiguous - objects of 100 x 100 and notes of 200 x 200, drags of round numbers of pixels, and
 * a camera at zoom 1, so one pixel of pointer is one unit of board. Every expected number below
 * can be checked in one's head, which is the point: a test that has to redo the implementation's
 * arithmetic only proves that the code does what the code does.
 *
 * Where the same drag is done to two different object types - a box that may change shape, a note
 * that may not, a shape that may not be resized at all - the test is about the story's claim that
 * selection is generic, and not about any one component.
 */

/** The camera the app starts with: world (0, 0) in the middle of a 1280 x 800 board. */
const CAMERA: Camera = { x: -640, y: -400, zoom: 1 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a point of the board lands on the screen. */
function at(world: { x: number; y: number }): { x: number; y: number } {
  return { x: world.x - CAMERA.x, y: world.y - CAMERA.y };
}

/** The middle of a box, which is where a press on an object has to land. */
function middleOf(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The point of a box, named the way the handles are named. */
function pointOf(box: Box, where: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w') {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const centre = middleOf(box);
  switch (where) {
    case 'nw':
      return { x: box.x, y: box.y };
    case 'n':
      return { x: centre.x, y: box.y };
    case 'ne':
      return { x: right, y: box.y };
    case 'e':
      return { x: right, y: centre.y };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: centre.x, y: bottom };
    case 'sw':
      return { x: box.x, y: bottom };
    case 'w':
      return { x: box.x, y: centre.y };
  }
}

/** The union of boxes, which is what the selection's eight handles are drawn around. */
function union(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

/* -------------------------------------------------- an object type that cannot be resized */

const LOCKED_TYPE = 'lockedbox';

function LockedBox({ object, selected }: ObjectProps): JSX.Element {
  return (
    <div
      data-testid="locked-box"
      data-object-id={object.id}
      data-object-type={LOCKED_TYPE}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
      }}
    />
  );
}

registerObjectType(LOCKED_TYPE, {
  Component: LockedBox,
  // The point of this type: it has a size, and no way to be asked to change it.
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (object, world) => rectContainsPoint({ x: object.x, y: object.y, width: object.width, height: object.height }, world),
});

function createLockedBox(doc: Y.Doc, box: Box): string {
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const id = `locked-${Math.random().toString(36).slice(2, 10)}`;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', LOCKED_TYPE);
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('z', 1);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/* ------------------------------------------------------------------ the app under test */

function boxOf(board: MountedSticky, id: string): Box {
  const object = board.object(id);
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/** Press an object, which selects it and only it. */
function selectOne(board: MountedSticky, id: string): void {
  clickAt(board.element(id), centreOnScreen(board, board.object(id)));
}

/** Ctrl + A, as a keyboard sends it. Returns whether the app took the key. */
function selectAllKey(): boolean {
  return fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
}

/** Press a handle and drag it: press where it is drawn, move, and let go where it stopped. */
async function dragHandle(
  board: MountedSticky,
  handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  box: Box,
  delta: { x: number; y: number },
  options: { shift?: boolean } = {},
): Promise<void> {
  const knob = board.handle(handle);
  const from = at(pointOf(box, handle));
  if (options.shift === true) {
    shiftPress(knob, from);
  } else {
    press(knob, from);
  }
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  moveTo(window, { x: from.x + 6, y: from.y });
  moveTo(window, to);
  await flushFrames();
  release(window, to);
  await flushFrames();
}

/** Drag an object by the pointer: press its middle, travel, and let go. */
async function dragObject(board: MountedSticky, id: string, delta: { x: number; y: number }): Promise<void> {
  const from = centreOnScreen(board, board.object(id));
  const element = board.element(id);
  press(element, from);
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  moveTo(window, { x: from.x + 6, y: from.y });
  moveTo(window, to);
  await flushFrames();
  release(window, to);
  await flushFrames();
}

/** Count every change the document was asked to make, however small. */
function countWrites(doc: Y.Doc): () => number {
  let writes = 0;
  doc.on('update', () => {
    writes += 1;
  });
  return () => writes;
}

describe('sel.move: one drag carries the selection (TC-23)', () => {
  let board: MountedSticky;
  let a: string;
  let b: string;

  /** Two notes, 300 apart, so one can be pressed without touching the other. */
  const A = { x: -400, y: -100 };
  const B = { x: -100, y: -100 };
  const A_BOX: Box = { x: A.x - 100, y: A.y - 100, width: 200, height: 200 };
  const B_BOX: Box = { x: B.x - 100, y: B.y - 100, width: 200, height: 200 };

  beforeEach(async () => {
    board = await mountSticky();
    a = createSticky(board.doc, A);
    b = createSticky(board.doc, B);
    await flushFrames();
  });

  it('TC-23: dragging an unselected note moves it alone, and selects it', async () => {
    selectOne(board, a);
    await flushFrames();
    expect(board.outlinedIds()).toEqual([a]);

    await dragObject(board, b, { x: 20, y: 10 });

    expect(boxOf(board, b)).toEqual({ ...B_BOX, x: B_BOX.x + 20, y: B_BOX.y + 10 });
    expect(boxOf(board, a)).toEqual(A_BOX);
    // The press chose a new object: what was selected is not along for the ride.
    expect(board.outlinedIds()).toEqual([b]);
  });

  it('TC-23b: dragging one of three selected moves all three, by the same amount', async () => {
    const c = createSticky(board.doc, { x: 300, y: 200 });
    await flushFrames();
    expect(selectAllKey()).toBe(false);
    await flushFrames();
    expect(board.outlineCount()).toBe(3);

    const before = snapshot(board.doc).map((object) => ({ id: object.id, x: object.x, y: object.y }));
    await dragObject(board, b, { x: 120, y: 40 });

    const after = snapshot(board.doc).map((object) => ({ id: object.id, x: object.x, y: object.y }));
    expect(after).toEqual(before.map((object) => ({ ...object, x: object.x + 120, y: object.y + 40 })));
    expect(board.draggingCount()).toBe(0);
    expect(board.outlinedIds().sort()).toEqual([a, b, c].sort());
  });

  it('TC-23c: two pixels of movement selects, and writes nothing at all', async () => {
    selectOne(board, a);
    await flushFrames();
    const writes = countWrites(board.doc);

    const from = centreOnScreen(board, board.object(b));
    press(board.box(1), from);
    moveTo(window, { x: from.x + 2, y: from.y + 2 });
    await flushFrames();
    release(window, { x: from.x + 2, y: from.y + 2 });
    await flushFrames();

    expect(writes()).toBe(0);
    expect(board.outlinedIds()).toEqual([b]);
    expect(board.draggingCount()).toBe(0);
  });

  it('TC-23d: twenty pointer moves are a handful of writes, not twenty', async () => {
    const writes = countWrites(board.doc);
    const object = board.object(a);
    const from = centreOnScreen(board, object);
    press(board.box(0), from);
    // The pointer reports far more often than a screen can show, and every write is a change sent
    // to everybody: the writes are batched to the frame, not to the pointer.
    for (let step = 1; step <= 20; step += 1) {
      moveTo(window, { x: from.x + step * 10, y: from.y });
    }
    await flushFrames();
    release(window, { x: from.x + 200, y: from.y });
    await flushFrames();

    expect(writes()).toBeLessThan(8);
    expect(writes()).toBeGreaterThan(1);
    expect(board.object(a).x).toBe(A_BOX.x + 200);
  });

  it('TC-23e: a note a colleague deletes mid-drag stays deleted', async () => {
    const from = centreOnScreen(board, board.object(a));
    press(board.box(0), from);
    moveTo(window, { x: from.x + 30, y: from.y });
    await flushFrames();

    deleteObjects(board.doc, [b]);
    await flushFrames();

    moveTo(window, { x: from.x + 90, y: from.y + 40 });
    await flushFrames();
    release(window, { x: from.x + 90, y: from.y + 40 });
    await flushFrames();

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([a]);
    expect(board.object(a).x).toBe(A_BOX.x + 90);
    expect(board.draggingCount()).toBe(0);
    expect(board.outlinedIds()).not.toContain(b);
  });

  it('TC-23f: a cancelled drag leaves the notes where they were last put', async () => {
    const from = centreOnScreen(board, board.object(a));
    press(board.box(0), from);
    moveTo(window, { x: from.x + 60, y: from.y + 20 });
    await flushFrames();
    const placed = boxOf(board, a);

    // The pointer is lifted a long way away, afterwards. Neither position is the one it lands on.
    cancelDrag(window, { x: from.x + 300, y: from.y + 300 });
    await flushFrames();

    expect(boxOf(board, a)).toEqual(placed);
    expect(board.draggingCount()).toBe(0);
  });

  it('TC-23g: notes that are nowhere near each other travel the same distance', async () => {
    const c = createSticky(board.doc, { x: 300, y: 200 });
    await flushFrames();
    selectAllKey();
    await flushFrames();

    const before = snapshot(board.doc).map((object) => ({ id: object.id, x: object.x, y: object.y }));
    await dragObject(board, c, { x: -70, y: 35 });

    for (const object of snapshot(board.doc)) {
      const was = before.find((entry) => entry.id === object.id)!;
      expect({ x: object.x - was.x, y: object.y - was.y }).toEqual({ x: -70, y: 35 });
    }
  });

  it('TC-23h: the selection comes to the front as it is grabbed', async () => {
    // A note that started on top of the selected one must not stay in front of it while it is
    // being dragged across the board.
    const onTop = createSticky(board.doc, { x: -250, y: -100 });
    await flushFrames();
    selectOne(board, a);
    await flushFrames();
    expect(board.object(onTop).z).toBeGreaterThan(board.object(a).z);

    await dragObject(board, b, { x: 10, y: 0 });

    expect(board.object(b).z).toBeGreaterThan(board.object(onTop).z);
    // The note that was not part of the gesture keeps its place in the queue.
    expect(board.object(a).z).toBeLessThan(board.object(onTop).z);
  });
});

describe('sel.resize: the handles (TC-24)', () => {
  let board: MountedSticky;
  let box: string;

  /** A box of 100 x 100 at the origin: every expected size below is one multiplication. */
  const ONE: Box = { x: 0, y: 0, width: 100, height: 100 };

  beforeEach(async () => {
    forgetProviders();
    board = await mountSticky();
    box = createTestbox(board.doc, ONE);
    await flushFrames();
    selectOne(board, box);
    await flushFrames();
  });

  it('TC-24: eight handles, each named for the side or corner it sits on', () => {
    expect(board.handleList().map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
    ]);
  });

  it('TC-24b: the right handle changes the width, and nothing else', async () => {
    await dragHandle(board, 'e', ONE, { x: 100, y: 0 });

    expect(boxOf(board, box)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('TC-24c: the left handle takes it off the other end, so the object moves too', async () => {
    await dragHandle(board, 'w', ONE, { x: 40, y: 0 });

    // The right edge did not move: x went from 0 to 40 and the width came off by exactly that.
    expect(boxOf(board, box)).toEqual({ x: 40, y: 0, width: 60, height: 100 });
  });

  it('TC-24d: the top handle changes the height alone', async () => {
    await dragHandle(board, 'n', ONE, { x: 0, y: -50 });

    expect(boxOf(board, box)).toEqual({ x: 0, y: -50, width: 100, height: 150 });
  });

  it('TC-24e: a corner handle changes both axes at once', async () => {
    await dragHandle(board, 'se', ONE, { x: 50, y: 50 });

    expect(boxOf(board, box)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('TC-24f: Shift holds the proportions of a type that has none', async () => {
    await dragHandle(board, 'e', ONE, { x: 100, y: 0 }, { shift: true });

    // A box has no shape of its own, so the shape that was asked for is the shape it got. The
    // middle of the left edge is what did not move, so the box grew as much upwards as down.
    expect(boxOf(board, box)).toEqual({ x: 0, y: -50, width: 200, height: 200 });
  });

  it('TC-24g: a sticky note keeps its square without being asked to', async () => {
    const note = createSticky(board.doc, { x: 500, y: 0 });
    await flushFrames();
    selectOne(board, note);
    await flushFrames();

    // The note's own box, 200 across: the right handle is at its right edge, mid-height.
    await dragHandle(board, 'e', { x: 400, y: -100, width: 200, height: 200 }, { x: 100, y: 0 });

    // One and a half times as big, on both axes, from the same middle height.
    expect(boxOf(board, note)).toEqual({ x: 400, y: -150, width: 300, height: 300 });
  });

  it('TC-24h: an inward drag stops at the size the object type allows', async () => {
    await dragHandle(board, 'e', ONE, { x: -95, y: 0 });

    // 100 - 95 is 5, and a testbox's floor is 10: the handle is where the pointer is not, and the
    // box is where its own floor says it must be.
    expect(boxOf(board, box).width).toBe(TESTBOX_MIN_SIZE);
    expect(boxOf(board, box).height).toBe(ONE.height);
  });

  it('TC-24i: and it stops at the floor of its own type, not of another one', async () => {
    const note = createSticky(board.doc, { x: 500, y: 0 });
    await flushFrames();
    selectOne(board, note);
    await flushFrames();

    await dragHandle(board, 'se', { x: 400, y: -100, width: 200, height: 200 }, { x: -160, y: -160 });

    // A note may be shrunk to 50 and no further: the 40 the pointer asked for is below its floor.
    // A testbox in the same place would have gone down to 10.
    expect(boxOf(board, note)).toEqual({ x: 400, y: -100, width: 50, height: 50 });
  });

  it('TC-24j: a handle dragged past the far edge leaves the object alone', async () => {
    await dragHandle(board, 'e', ONE, { x: -400, y: 0 });

    // There is no such thing as a box of negative width, and no such thing as having dragged the
    // handle through the opposite edge and out the other side.
    expect(boxOf(board, box)).toEqual(ONE);
  });

  it('TC-24k: a resize is a gesture, so the object says so while it lasts', async () => {
    const from = at(pointOf(ONE, 'e'));
    press(board.handle('e'), from);
    moveTo(window, { x: from.x + 40, y: from.y });
    await flushFrames();

    expect(testboxElements(board.view)[0]!.dataset.dragging).toBe('true');
    release(window, { x: from.x + 40, y: from.y });
    await flushFrames();
    expect(testboxElements(board.view)[0]!.dataset.dragging).toBe('false');
  });

  it('TC-24l: the handles are placed in screen pixels, so they stay the size of a mouse target', () => {
    const size = Number.parseFloat(board.handle('e').style.width);
    expect(size).toBeCloseTo(8, 5);
    // ...and the outline is placed in units of the board, so it stays on the object.
    expect(board.outlineCount()).toBe(1);
  });
});

describe('sel.resize: a group of objects (TC-25)', () => {
  let board: MountedSticky;
  let first: string;
  let second: string;

  /** Two boxes with 200 between them, so a scaled gap is easy to read: 200 becomes 300 at 1.5. */
  const ONE: Box = { x: 0, y: 0, width: 100, height: 100 };
  const TWO: Box = { x: 300, y: 0, width: 100, height: 100 };
  const SELECTION: Box = { x: 0, y: 0, width: 400, height: 100 };

  beforeEach(async () => {
    forgetProviders();
    board = await mountSticky();
    first = createTestbox(board.doc, ONE);
    second = createTestbox(board.doc, TWO);
    await flushFrames();
    selectAllKey();
    await flushFrames();
  });

  it('TC-25: one handle scales both boxes, and the space between them', async () => {
    // The two boxes are 400 x 100 together, so the handle at their bottom-right is at (400, 100),
    // and dragging it to (600, 200) makes the whole arrangement half again as big.
    expect(board.boundsOrNull()).not.toBeNull();
    await dragHandle(board, 'se', SELECTION, { x: 200, y: 100 });

    expect(boxOf(board, first)).toEqual({ x: 0, y: 0, width: 150, height: 200 });
    expect(boxOf(board, second)).toEqual({ x: 450, y: 0, width: 150, height: 200 });
    // The same arrangement, bigger: the gap scaled with the objects instead of being left behind.
    expect(boxOf(board, second).x - (boxOf(board, first).x + boxOf(board, first).width)).toBe(300);
  });

  it('TC-25b: the scale is chosen once, so no object stops short of the others', async () => {
    // Shrunk far past any floor: both boxes end at the same fraction of their size, because the
    // limit is found for the selection and then applied to everything inside it.
    await dragHandle(board, 'se', SELECTION, { x: -395, y: -95 });

    const a = boxOf(board, first);
    const b = boxOf(board, second);
    expect(a.width / ONE.width).toBeCloseTo(b.width / TWO.width, 10);
    expect(a.height / ONE.height).toBeCloseTo(b.height / TWO.height, 10);
    expect(Math.min(a.width, a.height, b.width, b.height)).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE);
    // The top-left of the selection did not move: that is the end the handle was dragged from.
    expect([a.x, a.y, b.y]).toEqual([0, 0, 0]);
  });

  it('TC-25c: an object whose type cannot be resized is left exactly where it was', async () => {
    const locked = createLockedBox(board.doc, { x: 0, y: 300, width: 100, height: 100 });
    await flushFrames();
    selectAllKey();
    await flushFrames();
    // Handles are offered, because something in the selection can be resized...
    expect(board.handleList()).toHaveLength(8);

    // ...and the box they scale is the whole selection: 400 across, 400 down.
    await dragHandle(board, 'se', union(ONE, TWO, { x: 0, y: 300, width: 100, height: 100 }), {
      x: 200,
      y: 0,
    });

    expect(boxOf(board, locked)).toEqual({ x: 0, y: 300, width: 100, height: 100 });
    expect(boxOf(board, first)).toEqual({ x: 0, y: 0, width: 150, height: 100 });
  });

  it('TC-25d: a selection of nothing has no handles, no outlines and no bar', async () => {
    deleteObjects(board.doc, [first, second]);
    await flushFrames();

    expect(board.handleList()).toHaveLength(0);
    expect(board.outlineCount()).toBe(0);
    expect(board.barOrNull()).toBeNull();
  });

  it('TC-25e: a locked box on its own is selected but never offered a handle', async () => {
    deleteObjects(board.doc, [first, second]);
    const locked = createLockedBox(board.doc, ONE);
    await flushFrames();
    selectAllKey();
    await flushFrames();

    expect(board.outlineCount()).toBe(1);
    expect(board.handleList()).toHaveLength(0);
    expect(boxOf(board, locked)).toEqual(ONE);
  });
});

describe('sel.write: a board that came down while it was being read (TC-25f)', () => {
  it('TC-25f: nobody may write to it, so nothing it is asked to do writes anything at all', async () => {
    // The same board, the same handles, the same drags: the only thing that is different is that
    // the room said it could not read this board. Selection is allowed - looking is allowed - and
    // every one of the ways of changing the board below has to leave the document untouched.
    const opened = await loadFailedBoard();
    const { board: quiet, writes } = opened;
    const ids = snapshot(opened.doc).map((object) => object.id);
    const before = snapshot(opened.doc).map(
      (object) => [object.x, object.y, object.width, object.height],
    );

    selectAllKey();
    await flushFrames();
    expect(quiet.outlineCount()).toBe(ids.length);

    // Move, resize, nudge, delete: every way this story gives a person of changing the board.
    await dragObject(quiet, ids[0]!, { x: 100, y: 100 });
    if (quiet.handleList().length > 0) {
      await dragHandle(quiet, 'se', { x: 0, y: 0, width: 400, height: 100 }, { x: 100, y: 100 });
    }
    pressKey('ArrowRight');
    pressKey('Delete');
    await flushFrames();

    expect(writes()).toBe(0);
    expect(snapshot(opened.doc).map((object) => object.id)).toEqual(ids);
    expect(snapshot(opened.doc).map((object) => [object.x, object.y, object.width, object.height])).toEqual(
      before,
    );
  });
});

describe('sel.gesture: the beginning and the end of one (TC-26)', () => {
  let started = vi.fn();
  let ended = vi.fn();

  beforeEach(() => {
    started = vi.fn();
    ended = vi.fn();
  });

  it('TC-26: start and end are each called once per drag, however much the pointer moves', async () => {
    const { doc, ids, gesture } = await mountGesture([ONE()], {
      onGestureStart: started,
      onGestureEnd: ended,
    });
    const from = at({ x: 50, y: 50 });
    gesture.onObjectPointerDown(pointerOn(ids[0]!, from), ids[0]!);
    // Choosing is not a gesture: nothing has been asked of the document yet.
    expect(started).not.toHaveBeenCalled();

    moveTo(window, { x: from.x + 30, y: from.y });
    await flushFrames();
    moveTo(window, { x: from.x + 60, y: from.y + 20 });
    await flushFrames();
    moveTo(window, { x: from.x + 61, y: from.y + 21 });
    await flushFrames();
    release(window, { x: from.x + 61, y: from.y + 21 });
    await flushFrames();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    // Where the pointer stopped, not where the last frame happened to leave it.
    expect(snapshot(doc)[0]!.x).toBe(61);
  });

  it('TC-26b: a cancelled drag ends the gesture once and keeps the last position applied', async () => {
    const { doc, ids, gesture } = await mountGesture([ONE()], {
      onGestureStart: started,
      onGestureEnd: ended,
    });
    const from = at({ x: 50, y: 50 });
    gesture.onObjectPointerDown(pointerOn(ids[0]!, from), ids[0]!);
    moveTo(window, { x: from.x + 20, y: from.y });
    await flushFrames();
    const placed = snapshot(doc)[0]!.x;

    cancelDrag(window, { x: from.x + 20, y: from.y });
    await flushFrames();
    // The pointer is lifted afterwards: there is no second end of a gesture that already ended.
    release(window, { x: from.x + 400, y: from.y });
    await flushFrames();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    // Neither back to where it began nor to where the pointer went: where it was left.
    expect(snapshot(doc)[0]!.x).toBe(placed);
  });

  it('TC-26c: a press that never travels is not a gesture', async () => {
    const { doc, ids, gesture, carrying } = await mountGesture([ONE()], {
      onGestureStart: started,
      onGestureEnd: ended,
    });
    const from = at({ x: 50, y: 50 });
    gesture.onObjectPointerDown(pointerOn(ids[0]!, from), ids[0]!);
    moveTo(window, { x: from.x + 2, y: from.y + 2 });
    release(window, { x: from.x + 2, y: from.y + 2 });
    await flushFrames();

    expect(started).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    expect(carrying).not.toHaveBeenCalled();
    expect(snapshot(doc)[0]!.x).toBe(ONE().x);
  });

  it('TC-26d: objects that are being carried are named once, and unnamed at the end', async () => {
    const { ids, gesture, carrying } = await mountGesture([ONE(), TWO_BOX()], { withSelection: true });
    const from = at({ x: 50, y: 50 });
    gesture.onObjectPointerDown(pointerOn(ids[0]!, from), ids[0]!);
    moveTo(window, { x: from.x + 30, y: from.y });
    await flushFrames();
    release(window, { x: from.x + 30, y: from.y });
    await flushFrames();

    expect(carrying.mock.calls[0]).toEqual([ids, true]);
    expect(carrying).toHaveBeenLastCalledWith([], false);
  });

  it('TC-26e: a board that cannot be written to never begins a gesture at all', async () => {
    const { ids, gesture } = await mountGesture([ONE()], {
      canEdit: false,
      onGestureStart: started,
      onGestureEnd: ended,
    });
    const from = at({ x: 50, y: 50 });
    gesture.onObjectPointerDown(pointerOn(ids[0]!, from), ids[0]!);
    moveTo(window, { x: from.x + 100, y: from.y + 100 });
    await flushFrames();
    release(window, { x: from.x + 100, y: from.y + 100 });
    await flushFrames();

    expect(started).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ the harness */

/** A box of 100 x 100 at the origin. */
function ONE(): Box {
  return { x: 0, y: 0, width: 100, height: 100 };
}

/** The same, 300 to the right of it, so the two are 200 apart. */
function TWO_BOX(): Box {
  return { x: 300, y: 0, width: 100, height: 100 };
}

interface GestureHarness {
  doc: Y.Doc;
  ids: string[];
  selection: MultiSelection;
  gesture: TransformGesture;
  carrying: ReturnType<typeof vi.fn>;
}

/**
 * The selection and the transform gesture, mounted together over a document of the boxes given:
 * the two hooks the app runs side by side, without the app's rendering around them. Enough of the
 * app to have a selection, and little enough that a callback can be counted rather than inferred
 * from what happened to be on the screen.
 */
async function mountGesture(
  boxes: readonly Box[],
  options: {
    canEdit?: boolean;
    withSelection?: boolean;
    onGestureStart?(): void;
    onGestureEnd?(): void;
  } = {},
): Promise<GestureHarness> {
  const doc = new Y.Doc();
  const ids = boxes.map((box) => createTestbox(doc, box));
  const objects: readonly ObjectSnapshot[] = snapshot(doc);
  const carrying = vi.fn();

  const view = renderHook(() => {
    const selection = useSelection(objects);
    const gesture = useTransformGesture({
      doc,
      camera: CAMERA,
      snapshot: objects,
      selection,
      canEdit: options.canEdit ?? true,
      onGestureStart: options.onGestureStart,
      onGestureEnd: options.onGestureEnd,
      onTransformingChange: carrying,
    });
    return { selection, gesture };
  });

  if (options.withSelection === true) {
    // Asked for after the render, the way a click would ask for it, and given the frame it takes
    // for that choice to reach the hook that has to act on it.
    act(() => {
      view.result.current.selection.setMany(ids, false);
    });
    await flushFrames();
  }

  return {
    doc,
    ids,
    selection: view.result.current.selection,
    gesture: view.result.current.gesture,
    carrying,
  };
}

/** A pointer event as an object component hands one to the board. */
function pointerOn(
  id: string,
  point: { x: number; y: number },
  options: { shift?: boolean; button?: number; pointerId?: number } = {},
): ObjectPointerEvent {
  const element = document.createElement('div');
  element.dataset.objectId = id;
  document.body.append(element);
  return {
    currentTarget: element,
    target: element,
    pointerId: options.pointerId ?? 1,
    pointerType: 'mouse',
    button: options.button ?? 0,
    buttons: 1,
    shiftKey: options.shift === true,
    clientX: point.x,
    clientY: point.y,
    preventDefault(): void {},
    stopPropagation(): void {},
  } as unknown as ObjectPointerEvent;
}

/** A board whose room could not be read, so nobody is allowed to write to it. */
async function loadFailedBoard(): Promise<{
  doc: Y.Doc;
  board: MountedSticky;
  provider: FakeWebsocketProvider;
  writes(): number;
}> {
  const doc = new Y.Doc();
  createTestbox(doc, ONE());
  createTestbox(doc, TWO_BOX());
  const board = await mountSticky(doc, { boardId: 'b1' });
  const provider = theProvider();
  provider.socketOpens();
  provider.sync();
  await flushFrames();
  provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
  await flushFrames();
  // Counted from here on, once the board has come down: everything the tests below do is something
  // the app was asked to do to a board it can no longer be sure of.
  const writes = countWrites(doc);
  return { doc, board, provider, writes };
}
