/**
 * Story 7 component tests: resizing, and the parts of the move/resize gesture that only
 * show up when you look at the gesture itself.
 *
 * Most of these need an object that is *not* a sticky note, because the story's promise is
 * that the generic layer works for any type a later story registers. `tests/fixtures/testbox`
 * is exactly that: a box that can be resized but has no proportions to keep, and a minimum
 * size of its own. Where a test can be run through the whole screen it is; the tests about
 * the gesture hook's own contract — refusing to write on a board nobody can edit, and
 * telling story 8 where a gesture begins and ends — drive the hook directly, because what
 * they assert is a callback the screen does not use yet.
 */

import { act, cleanup, render, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { boardObjects, createSticky, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import { createTestBox, registerTestBox, TESTBOX_MIN_SIZE } from '../fixtures/testbox';
import {
  firePointer,
  flushCameraFrame,
  flushFrames,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera
} from './harness';

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
  // The second object type, so "generic" can be told apart from "sticky note".
  registerTestBox();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A camera the hook tests can compute against by hand. */
const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };

/** The shape a component hands the gesture when a pointer lands on it. */
function press(x: number, y: number, options: { shift?: boolean; button?: number } = {}) {
  return {
    clientX: x,
    clientY: y,
    shiftKey: options.shift ?? false,
    button: options.button ?? 0,
    pointerId: 1,
    stopPropagation: () => {}
  };
}

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
  object(id: string): ObjectSnapshot;
}

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const { container } = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  const objects = () => boardObjects(doc);
  return {
    doc,
    root: container,
    objects,
    object: (id: string) => {
      const found = objects().find((candidate) => candidate.id === id);
      if (!found) throw new Error(`object ${id} is not on the board`);
      return found;
    }
  };
}

/** Put a testbox on the board, centred on a world point. */
function addTestBox(board: BoardFixture, centre: Point, size = { width: 200, height: 100 }): string {
  let id = '';
  act(() => {
    id = createTestBox(board.doc, { x: centre.x - size.width / 2, y: centre.y - size.height / 2 }, size);
  });
  return id;
}

/** Put a sticky note on the board, centred on a world point, with a stored size. */
function addNote(board: BoardFixture, centre: Point): string {
  let id = '';
  act(() => {
    id = createSticky(board.doc, centre);
    // Story 6 writes sizes; a note made before it has none. Give this one one so the two
    // can be told apart from a document that predates the story.
    const objects = board.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    objects.get(id)?.set('width', STICKY_SIZE_WORLD);
    objects.get(id)?.set('height', STICKY_SIZE_WORLD);
  });
  return id;
}

/** Press a resize handle, move it in steps, release. */
async function dragHandle(
  board: BoardFixture,
  handle: string,
  from: Point,
  to: Point,
  shift = false
): Promise<void> {
  const element = board.root.querySelector<HTMLElement>(`[data-vidi6="resize-handle"][data-handle="${handle}"]`);
  if (!element) throw new Error(`there is no ${handle} resize handle on screen`);
  firePointer(element, 'pointerdown', from.x, from.y, { shiftKey: shift });
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      element,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
      { shiftKey: shift }
    );
    await flushFrames();
  }
  firePointer(element, 'pointerup', to.x, to.y, { shiftKey: shift });
  await flushFrames();
}

/** Where an object's centre, and one of its edges, land on the screen. */
function centreOf(board: BoardFixture, id: string): Point {
  return worldToScreen(testCamera(), centrePoint(board.object(id)));
}

function centrePoint(object: ObjectSnapshot): Point {
  const bounds = objectBounds(object);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** Click an object so that it is the selection, without moving it. */
function clickObject(board: BoardFixture, id: string, shift = false): void {
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`object ${id} is not on screen`);
  const point = centreOf(board, id);
  firePointer(element, 'pointerdown', point.x, point.y, { shiftKey: shift });
  firePointer(element, 'pointerup', point.x, point.y, { shiftKey: shift });
}

describe('resizing one object (sel.resize)', () => {
  it('TC-24: an edge handle changes one size of a box that has no proportions to keep', async () => {
    const board = await renderBoard();
    const id = addTestBox(board, { x: 0, y: 0 }, { width: 200, height: 100 });
    clickObject(board, id);
    const before = objectBounds(board.object(id));

    const right = worldToScreen(testCamera(), { x: 100, y: 0 });
    await dragHandle(board, 'e', right, { x: right.x + 100, y: right.y });

    const after = objectBounds(board.object(id));
    expect(after.width).toBeCloseTo(before.width + 100, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
    // The edge being dragged moved; the opposite edge stayed where it was.
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-24: holding Shift while resizing a box keeps its proportions', async () => {
    const board = await renderBoard();
    const id = addTestBox(board, { x: 0, y: 0 }, { width: 200, height: 100 });
    clickObject(board, id);
    const before = objectBounds(board.object(id));

    const right = worldToScreen(testCamera(), { x: 100, y: 0 });
    await dragHandle(board, 'e', right, { x: right.x + 100, y: right.y }, true);

    const after = objectBounds(board.object(id));
    expect(after.width).toBeCloseTo(before.width + 100, 6);
    expect(after.height).toBeCloseTo(before.height * ((before.width + 100) / before.width), 6);
  });

  it('a box stops shrinking at its own minimum, a sticky note at its own', async () => {
    const board = await renderBoard();
    const box = addTestBox(board, { x: 0, y: 0 }, { width: 200, height: 100 });
    clickObject(board, box);
    const right = worldToScreen(testCamera(), { x: 100, y: 0 });
    await dragHandle(board, 'e', right, { x: right.x - 500, y: right.y });
    expect(objectBounds(board.object(box)).width).toBeCloseTo(TESTBOX_MIN_SIZE, 6);

    const note = addNote(board, { x: 1400, y: 0 });
    clickObject(board, note);
    const noteRight = worldToScreen(testCamera(), { x: 1400 + STICKY_SIZE_WORLD / 2, y: 0 });
    await dragHandle(board, 'e', noteRight, { x: noteRight.x - 500, y: noteRight.y });
    const shrunk = objectBounds(board.object(note));
    expect(shrunk.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    // An object whose proportions are kept stays square at its minimum too.
    expect(shrunk.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('a mixed selection is resized uniformly, so nothing is squashed out of shape', async () => {
    const board = await renderBoard();
    const box = addTestBox(board, { x: 0, y: 0 }, { width: 200, height: 100 });
    const note = addNote(board, { x: 800, y: 0 });
    clickObject(board, box);
    clickObject(board, note, true);

    // The selection's bottom-right corner is the note's bottom-right corner.
    const corner = worldToScreen(testCamera(), { x: 800 + STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    await dragHandle(board, 'se', corner, { x: corner.x + 200, y: corner.y + 200 });

    const afterBox = objectBounds(board.object(box));
    const afterNote = objectBounds(board.object(note));
    expect(afterNote.width).toBeCloseTo(afterNote.height, 6);
    expect(afterBox.height / afterBox.width).toBeCloseTo(100 / 200, 6);
    expect(afterBox.width).toBeGreaterThan(200);
    // And they stayed where they were relative to each other.
    expect(afterBox.x).toBeCloseTo(centrePoint(board.object(box)).x - afterBox.width / 2, 6);
  });

  it('an object of a type this build cannot draw is not on the board to resize', async () => {
    const board = await renderBoard();
    const id = addTestBox(board, { x: 0, y: 0 });
    clickObject(board, id);
    expect(board.root.querySelectorAll('[data-vidi6="resize-handle"]')).toHaveLength(8);

    // A newer client writes a type this build has never heard of: it is neither drawn nor
    // selectable, so it cannot end up in a resize (TC-12 is the reading side of this).
    act(() => {
      const objects = board.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const ghost = new Y.Map<unknown>();
      ghost.set('type', 'shape-from-the-future');
      ghost.set('x', 40);
      ghost.set('y', 40);
      ghost.set('width', 100);
      ghost.set('height', 100);
      ghost.set('z', 99);
      objects.set('ghost', ghost);
    });

    expect(board.objects().map((object) => object.id)).toEqual([id]);
    expect(board.root.querySelector('[data-object-id="ghost"]')).toBeNull();
  });
});

describe('what a gesture may not do (sel.permission, story 8 boundaries)', () => {
  interface Harness {
    doc: Y.Doc;
    phases: string[];
    first: string;
    second: string;
    current(): {
      gesture: ReturnType<typeof useTransformGesture>;
      selection: ReturnType<typeof useSelection>;
    };
    unmount(): void;
  }

  function setup(canEdit: boolean): Harness {
    const doc = new Y.Doc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 900, y: 0 });
    const phases: string[] = [];
    const view = renderHook(() => {
      const objects = boardObjects(doc);
      const selection = useSelection(objects);
      const gesture = useTransformGesture({
        doc,
        camera: IDENTITY,
        selection,
        snapshot: objects,
        canEdit,
        onGestureStart: () => phases.push('start'),
        onGestureEnd: () => phases.push('end')
      });
      return { gesture, selection };
    });
    return {
      doc,
      phases,
      first,
      second,
      current: () => view.result.current,
      unmount: () => view.unmount()
    };
  }

  const where = (harness: Harness, id: string): ObjectSnapshot => {
    const object = boardObjects(harness.doc).find((candidate) => candidate.id === id);
    if (!object) throw new Error(`object ${id} is not on the board`);
    return object;
  };

  it('TC-25: nothing moves on a board nobody can edit', () => {
    const harness = setup(false);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    firePointer(document.body, 'pointermove', 200, 0);
    firePointer(document.body, 'pointerup', 200, 0);

    const after = where(harness, harness.first);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // A gesture that cannot write does not open a story 8 undo item either.
    expect(harness.phases).toEqual([]);
  });

  it('a gesture does not outlive the board it started on', () => {
    const harness = setup(true);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    firePointer(document.body, 'pointermove', 60, 0);
    expect(where(harness, harness.first).x - before.x).toBeCloseTo(60, 6);

    // The board goes away mid-drag. Whatever the pointer does next belongs to nobody.
    harness.unmount();
    firePointer(document.body, 'pointermove', 400, 0);
    firePointer(document.body, 'pointerup', 400, 0);

    expect(where(harness, harness.first).x - before.x).toBeCloseTo(60, 6);
    // The end still comes: story 8 opens an undo item at the start of a gesture, and an
    // item left open forever is worse than one closed at the last place it got to.
    expect(harness.phases).toEqual(['start', 'end']);
  });

  it('TC-26: a gesture announces one start and one end, around the writes', async () => {
    const harness = setup(true);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    for (const x of [40, 80, 120]) {
      firePointer(document.body, 'pointermove', x, 0);
      await flushFrames();
    }
    firePointer(document.body, 'pointerup', 120, 0);
    await flushFrames();

    // Story 8 wraps these two moments in a single undo item, so they must come exactly
    // once each however many frames the drag spanned.
    expect(harness.phases).toEqual(['start', 'end']);
    expect(where(harness, harness.first).x - before.x).toBeCloseTo(120, 6);
  });

  it('a press that never becomes a drag announces nothing at all', () => {
    const harness = setup(true);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    firePointer(document.body, 'pointermove', 1, 0);
    firePointer(document.body, 'pointerup', 1, 0);

    expect(harness.phases).toEqual([]);
    expect(where(harness, harness.first).x).toBeCloseTo(before.x, 6);
  });

  it('an interrupted gesture still closes what it opened', async () => {
    const harness = setup(true);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    firePointer(document.body, 'pointermove', 90, 0);
    await flushFrames();
    firePointer(document.body, 'pointercancel', 900, 900);

    expect(harness.phases).toEqual(['start', 'end']);
    // An interrupted drag keeps the last position that was drawn, not the pointer's last.
    expect(where(harness, harness.first).x - before.x).toBeCloseTo(90, 6);
  });

  it('dragging an object that is not selected moves it alone', () => {
    const harness = setup(true);
    act(() => harness.current().selection.click(harness.first));
    const before = { first: where(harness, harness.first), second: where(harness, harness.second) };

    act(() => harness.current().gesture.onObjectPointerDown(press(900, 0), harness.second));
    firePointer(document.body, 'pointermove', 1000, 0);
    firePointer(document.body, 'pointerup', 1000, 0);

    expect(where(harness, harness.second).x - before.second.x).toBeCloseTo(100, 6);
    expect(where(harness, harness.first).x).toBeCloseTo(before.first.x, 6);
  });

  it('the right button never starts a gesture, so the browser menu still works', () => {
    const harness = setup(true);
    const before = where(harness, harness.first);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0, { button: 2 }), harness.first));
    firePointer(document.body, 'pointermove', 200, 0, { button: 2 });
    firePointer(document.body, 'pointerup', 200, 0, { button: 2 });

    expect(where(harness, harness.first).x).toBeCloseTo(before.x, 6);
    expect(harness.current().gesture.transforming.size).toBe(0);
  });

  it('a Shift press adds or removes, and never drags', () => {
    const harness = setup(true);
    act(() => harness.current().selection.click(harness.first));
    const before = where(harness, harness.second);

    act(() => harness.current().gesture.onObjectPointerDown(press(900, 0, { shift: true }), harness.second));
    firePointer(document.body, 'pointermove', 1200, 0);
    firePointer(document.body, 'pointerup', 1200, 0);

    expect(where(harness, harness.second).x).toBeCloseTo(before.x, 6);
    expect(new Set(harness.current().selection.ids)).toEqual(new Set([harness.first, harness.second]));
  });

  it('the objects a gesture is moving are reported while it moves', async () => {
    const harness = setup(true);
    expect(harness.current().gesture.transforming.size).toBe(0);

    act(() => harness.current().gesture.onObjectPointerDown(press(0, 0), harness.first));
    firePointer(document.body, 'pointermove', 40, 0);
    await flushFrames();
    expect(harness.current().gesture.transforming).toEqual(new Set([harness.first]));

    firePointer(document.body, 'pointerup', 40, 0);
    await flushFrames();
    expect(harness.current().gesture.transforming.size).toBe(0);
  });
});
