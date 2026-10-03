// The generic transform gesture: move + resize (sel.transform, ui-component).
//
// Move and resize share one gesture driven from the press state, so it is exact at
// any zoom and unaffected by remote changes mid-drag. A press on an unselected
// object re-selects to just that object; a resize of a non-aspect-locked type changes
// one axis (and Shift keeps the ratio); a load-failed board refuses every write; and
// the gesture's start / end callbacks fire exactly once per drag. The test-only
// `testbox` type (resizable, *not* aspect-locked) proves the gesture is generic.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  createSticky,
  initDoc,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { Camera } from '../../src/client/canvas/camera';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_MIN_SIZE_WORLD } from '../fixtures/testbox';
import {
  boardDoc,
  clickNote,
  createNote,
  noteBounds,
  noteEl,
  noteSelected,
  pointer,
  renderBoard,
} from './helpers';
import {
  lastProvider,
  resetProviderStub,
} from './y-websocket-stub';

const camera: Camera = { x: 0, y: 0, zoom: 1 };

/** A stand-in React pointer event carrying just what the gesture reads. */
function pointerEvent(
  clientX: number,
  clientY: number,
  shiftKey = false,
): ReactPointerEvent<HTMLElement> {
  return {
    clientX,
    clientY,
    shiftKey,
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    stopPropagation() {},
    currentTarget: document.body,
    target: document.body,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function windowPointer(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    window,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}

/** A registered, non-aspect-locked testbox in a fresh document + its snapshot. */
function testboxDoc(width = 200, height = 100) {
  const doc = new Y.Doc();
  initDoc(doc);
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', 0);
    m.set('y', 0);
    m.set('z', 1);
    m.set('width', width);
    m.set('height', height);
    m.set('createdAt', 0);
    doc.getMap<Y.Map<unknown>>('objects').set('tb', m);
  });
  const snap: readonly ObjectSnapshot[] = [
    { id: 'tb', type: 'testbox', x: 0, y: 0, z: 1, width, height, createdAt: 0 },
  ];
  return { doc, snap };
}

function dims(doc: Y.Doc): { width: number; height: number } {
  const m = doc.getMap<Y.Map<unknown>>('objects').get('tb')!;
  return { width: m.get('width') as number, height: m.get('height') as number };
}

describe('sel.transform (ui-component)', () => {
  // TC-23: pressing an unselected object while another is selected selects only the
  // pressed one, and dragging it moves only it.
  it('TC-23 moves only a freshly-pressed object and re-selects to it', () => {
    renderBoard();
    const a = createNote(0, 0);
    const b = createNote(800, 0);
    clickNote(a); // selection = {a}
    const beforeB = noteBounds(b);
    const beforeA = noteBounds(a);

    // Press and drag b (which is not in the selection).
    pointer(noteEl(b), 'pointerdown', 0, 0);
    pointer(noteEl(b), 'pointermove', 250, 0);
    pointer(noteEl(b), 'pointerup', 250, 0);

    expect(noteSelected(a)).toBe(false); // selection moved to b
    expect(noteSelected(b)).toBe(true);
    expect(noteBounds(b).x).toBeGreaterThan(beforeB.x); // b moved
    expect(noteBounds(a).x).toBe(beforeA.x); // a stayed put
  });

  // TC-24: a non-aspect-locked type's edge handle changes width only; Shift keeps ratio.
  it('TC-24 resizes one axis for a free type and keeps the ratio with Shift', () => {
    const { doc, snap } = testboxDoc(200, 100);
    const { result } = renderHook(() => {
      const selection = useSelection(snap);
      const gesture = useTransformGesture({
        doc,
        camera,
        selection,
        snapshot: snap,
        canEdit: true,
      });
      return { selection, gesture };
    });

    // Select the testbox, then drag its east handle: width grows, height unchanged.
    act(() => result.current.selection.setMany(['tb'], false));
    act(() => result.current.gesture.onHandlePointerDown(pointerEvent(0, 0), 'e'));
    act(() => windowPointer('pointermove', 120, 0));
    act(() => windowPointer('pointerup', 120, 0));
    expect(dims(doc).width).toBeCloseTo(320, 3);
    expect(dims(doc).height).toBeCloseTo(100, 3); // edge handle: width only

    // With Shift held the ratio is locked: both axes grow by the same factor.
    act(() => result.current.gesture.onHandlePointerDown(pointerEvent(0, 0, true), 'e'));
    act(() => windowPointer('pointermove', 100, 0));
    act(() => windowPointer('pointerup', 100, 0));
    const after = dims(doc);
    // Ratio after the Shifted drag equals the original 2:1.
    expect(after.width / after.height).toBeCloseTo(2, 1);
  });

  it('TC-24 clamps a testbox resize to its own minimum size', () => {
    const { doc, snap } = testboxDoc(200, 100);
    const { result } = renderHook(() => {
      const selection = useSelection(snap);
      const gesture = useTransformGesture({
        doc,
        camera,
        selection,
        snapshot: snap,
        canEdit: true,
      });
      return { selection, gesture };
    });
    act(() => result.current.selection.setMany(['tb'], false));
    // Shrink far below the type's minimum (10): drag the west edge inward.
    act(() => result.current.gesture.onHandlePointerDown(pointerEvent(0, 0), 'w'));
    act(() => windowPointer('pointermove', 400, 0));
    act(() => windowPointer('pointerup', 400, 0));
    expect(dims(doc).width).toBeCloseTo(TESTBOX_MIN_SIZE_WORLD, 3);
  });

  // TC-25 (negative): a board that could not be loaded refuses every transform.
  it('TC-25 refuses to move or delete on a load-failed board', () => {
    resetProviderStub();
    renderBoard();
    const id = createNote(200, 200);
    const provider = lastProvider();
    if (!provider) throw new Error('no provider');
    act(() => provider.emitSync(true));
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));

    const before = JSON.stringify(snapshot(boardDoc()));

    pointer(noteEl(id), 'pointerdown', 0, 0);
    pointer(noteEl(id), 'pointermove', 300, 300);
    pointer(noteEl(id), 'pointerup', 300, 300);
    fireEvent(
      window,
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );

    expect(noteSelected(id)).toBe(false); // not even selected
    expect(JSON.stringify(snapshot(boardDoc()))).toBe(before); // nothing changed
  });

  // TC-26: the start / end callbacks each fire exactly once per drag.
  it('TC-26 fires onGestureStart and onGestureEnd once each per drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();

    const { result } = renderHook(() => {
      const selection = useSelection(snap);
      const gesture = useTransformGesture({
        doc,
        camera,
        selection,
        snapshot: snap,
        canEdit: true,
        onGestureStart,
        onGestureEnd,
      });
      return { gesture };
    });

    // A press without movement is a click: no gesture callbacks.
    act(() => result.current.gesture.onObjectPointerDown(pointerEvent(0, 0), a));
    act(() => windowPointer('pointerup', 0, 0));
    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();

    // A real drag: exactly one start and one end, even across many move events.
    act(() => result.current.gesture.onObjectPointerDown(pointerEvent(0, 0), a));
    act(() => windowPointer('pointermove', 10, 0));
    act(() => windowPointer('pointermove', 60, 20));
    act(() => windowPointer('pointermove', 120, 40));
    act(() => windowPointer('pointerup', 120, 40));
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('TC-26 keeps the last applied position when a drag is cancelled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc);
    const { result } = renderHook(() => {
      const selection = useSelection(snap);
      const gesture = useTransformGesture({
        doc,
        camera,
        selection,
        snapshot: snap,
        canEdit: true,
      });
      return { selection, gesture };
    });
    act(() => result.current.gesture.onObjectPointerDown(pointerEvent(0, 0), a));
    act(() => windowPointer('pointermove', 150, 0));
    act(() => windowPointer('pointercancel', 150, 0));
    // The note stayed where the last move put it (150 units right of where it was),
    // even though the drag ended with a cancel rather than a release.
    const startX = objectBounds(snap.find((n) => n.id === a)!).x;
    expect(objectBounds(snapshot(doc).find((n) => n.id === a)!).x).toBeCloseTo(
      startX + 150,
      3,
    );
  });

  // Every selected resizable object offers eight "Resize <position>" handles.
  it('TC-24 exposes eight resize handles labelled by position', () => {
    renderBoard();
    const id = createNote(0, 0);
    clickNote(id);
    for (const label of [
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  // A type that is locked to its ratio stops at its smallest size *as the same shape*.
  //
  // The clamp is per axis, and for a box that may change shape that is exactly right. For one that may
  // not, the two axes reach their minimums at two different scales — a note twice as wide as it is tall
  // hits the floor on its height at half the scale its width does — so clamping them separately stops
  // the drag in two places at once and leaves a square where a rectangle was: the minimum honoured and
  // the one property the type is locked to, thrown away. Whichever axis runs out of room first is the
  // axis that stops the drag, and the other comes with it.
  // (Found by story 12's resize test — TC-27 there — and belongs to this gesture, not to pictures.)
  it('stops an aspect-locked resize at the minimum size with its shape intact', () => {
    renderBoard();
    const id = createNote(0, 0);
    // A note twice as wide as it is tall. The gesture is what normally writes a size; so is the board.
    act(() => {
      const m = boardDoc().getMap<Y.Map<unknown>>('objects').get(id)!;
      m.set('width', 400);
      m.set('height', 200);
    });
    clickNote(id);

    // Press the bottom-right corner and drag it through the floor of the world.
    const handle = screen.getByTestId('resize-handle-se');
    act(() => pointer(handle, 'pointerdown', 400, 200));
    act(() => windowPointer('pointermove', -3000, -3000));
    act(() => windowPointer('pointerup', -3000, -3000));

    const box = noteBounds(id);
    expect(
      Math.min(box.width, box.height),
      'the drag stops at the smallest size, not through it',
    ).toBe(STICKY_MIN_SIZE_WORLD);
    expect(box.width, 'and neither side goes under').toBeGreaterThan(STICKY_MIN_SIZE_WORLD - 1);
    expect(box.width / box.height, 'and it stops as the same shape it started').toBeCloseTo(2, 6);
  });
});
