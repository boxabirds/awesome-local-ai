// The gesture's own begin and end (`sel.transform`, TC-26).
//
// The rest of story 7's tests run against the whole board and read the document back.
// This one runs against the hook, because two of its rules are not visible in the
// document: that it reports "a gesture started" and "a gesture ended" exactly once per
// drag however many pointer events pass through it, and that a drag which is
// interrupted keeps the last position it applied rather than the one it started from.
//
// `rerender` is called between the steps on purpose: the hook reads the document
// through the options it was given on the last render, which is what the board does
// too (its snapshot store changes with every write). Without it a second drag would be
// measured against a stale snapshot, which is a property of the harness, not the hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useSelection } from '../../src/client/board/useSelection';
import {
  createSticky,
  initDoc,
  objectBounds,
  snapshotObjects,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { dispatchPointer, VIEWPORT } from './helpers/events';

const CAMERA = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 };

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const frame = (): void => {
  act(() => {
    vi.advanceTimersByTime(16);
  });
};

/** The world point over the middle of an object, as a screen point. */
const over = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const bounds = boxOf(doc, id);
  return {
    x: bounds.x + bounds.width / 2 - CAMERA.x,
    y: bounds.y + bounds.height / 2 - CAMERA.y,
  };
};

const boxOf = (doc: Y.Doc, id: string): Rect =>
  objectBounds(snapshotObjects(doc).find((object) => object.id === id)!);

/** A press event: the hook is handed what the object component handed it. */
const pointerDown = (at: { x: number; y: number }, shift = false): Event =>
  dispatchPointer(document.body, 'pointerdown', at.x, at.y, { shiftKey: shift });

const move = (at: { x: number; y: number }, shift = false): Event =>
  dispatchPointer(window, 'pointermove', at.x, at.y, { shiftKey: shift });

const release = (at: { x: number; y: number }): Event =>
  dispatchPointer(window, 'pointerup', at.x, at.y);

const cancel = (at: { x: number; y: number }): Event =>
  dispatchPointer(window, 'pointercancel', at.x, at.y);

/** The hook under test, over a real document holding two notes. */
function probe(onGestureStart?: () => void, onGestureEnd?: () => void) {
  const doc = new Y.Doc();
  initDoc(doc);
  const a = createSticky(doc, { x: 0, y: 0 });
  const b = createSticky(doc, { x: 300, y: 0 });
  flush();

  const view = renderHook(() => {
    const objects = snapshotObjects(doc);
    const selection = useSelection(objects);
    const gesture = useTransformGesture({
      doc,
      camera: CAMERA,
      selection,
      snapshot: objects,
      canEdit: true,
      onGestureStart,
      onGestureEnd,
    });
    return { gesture, selection };
  });

  /** Fresh document read, and the hook told about it, as the board would. */
  const settle = (): void => {
    flush();
    view.rerender();
  };

  return { doc, a, b, view, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('gesture callbacks (sel.transform)', () => {
  // TC-26: one gesture, one start and one end, however many moves pass through.
  it('TC-26 starts and ends exactly once per drag', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const { doc, a, view, settle } = probe(started, ended);
    const from = over(doc, a);

    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    settle();

    // Five moves over three frames: still one gesture.
    for (const step of [10, 20, 30, 40, 50]) {
      act(() => {
        move({ x: from.x + step, y: from.y + step / 2 });
      });
      frame();
    }
    act(() => {
      release({ x: from.x + 50, y: from.y + 25 });
    });
    settle();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 50, 6);
  });

  // A press that never moved far enough was a click: no gesture, so nothing said.
  it('says nothing about a press that never became a gesture', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const { doc, a, view, settle } = probe(started, ended);
    const from = over(doc, a);

    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    settle();
    act(() => {
      move({ x: from.x + 1, y: from.y + 1 });
    });
    act(() => {
      release({ x: from.x + 1, y: from.y + 1 });
    });
    settle();

    expect(started).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    expect(boxOf(doc, a).x).toBeCloseTo(-100, 6);
  });

  // A drag that is interrupted keeps what it had already applied.
  it('keeps the last applied position when the drag is cancelled', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const { doc, a, view, settle } = probe(started, ended);
    const from = over(doc, a);
    const before = boxOf(doc, a);

    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    settle();
    act(() => {
      move({ x: from.x + 80, y: from.y });
    });
    frame();
    act(() => {
      cancel({ x: from.x + 200, y: from.y });
    });
    settle();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    // The 80 that was applied is kept; the 200 the cancel landed on is not.
    expect(boxOf(doc, a).x).toBeCloseTo(before.x + 80, 6);
  });

  // Two drags are two gestures: nothing is left over from the first.
  it('starts and ends a second drag again', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const { doc, a, view, settle } = probe(started, ended);

    for (const distance of [40, 90]) {
      const from = over(doc, a);
      act(() => {
        view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
      });
      settle();
      act(() => {
        move({ x: from.x + distance, y: from.y });
      });
      act(() => {
        release({ x: from.x + distance, y: from.y });
      });
      settle();
    }

    expect(started).toHaveBeenCalledTimes(2);
    expect(ended).toHaveBeenCalledTimes(2);
    // Each drag moves the note by its own distance from wherever it was: the second
    // drag is measured from where the first left it, not from the original position.
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 40 + 90, 6);
  });

  // The document is written once per frame, not once per pointer event.
  it('writes at most once per frame', () => {
    const { doc, a, view, settle } = probe();
    const from = over(doc, a);

    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    settle();
    // The press itself wrote nothing: a press is a press.
    expect(boxOf(doc, a).x).toBeCloseTo(-100, 6);

    // Ten moves in one frame. The first of them is the gesture: everything after it
    // waits for the frame. (Absolute positions: the selection is where the pointer
    // says, so one write per frame is enough.)
    for (let step = 1; step <= 10; step += 1) {
      act(() => {
        move({ x: from.x + 10 + step * 5, y: from.y });
      });
    }
    // The first of them is the gesture: 15 screen pixels of it landed at once.
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 15, 6);

    frame();
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 60, 6);
    // Nothing else moves it until another pointer event arrives.
    frame();
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 60, 6);

    act(() => {
      move({ x: from.x + 80, y: from.y });
    });
    act(() => {
      release({ x: from.x + 80, y: from.y });
    });
    settle();
    // Release applies the newest delta itself, so the objects stop under the pointer.
    expect(boxOf(doc, a).x).toBeCloseTo(-100 + 80, 6);
  });

  // A resize is a gesture too, and says so once (`onHandlePointerDown`).
  it('counts a resize as one gesture', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const { doc, a, view, settle } = probe(started, ended);

    // Select the note first: handles only exist for a selection.
    const from = over(doc, a);
    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    act(() => {
      release(from);
    });
    settle();
    expect(started).not.toHaveBeenCalled();

    const handle = { x: from.x + 100, y: from.y };
    act(() => {
      view.result.current.gesture.onHandlePointerDown(pointerDown(handle) as PointerEvent, 'e');
    });
    settle();
    act(() => {
      move({ x: handle.x + 40, y: handle.y });
    });
    act(() => {
      release({ x: handle.x + 40, y: handle.y });
    });
    settle();

    expect(started).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(boxOf(doc, a).width).toBeCloseTo(240, 6);
  });

  // A board that cannot be edited says nothing either: no gesture was accepted.
  it('refuses to start a gesture it will not carry out', () => {
    const started = vi.fn();
    const ended = vi.fn();
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const view = renderHook(() => {
      const objects = snapshotObjects(doc);
      const selection = useSelection(objects);
      return {
        gesture: useTransformGesture({
          doc,
          camera: CAMERA,
          selection,
          snapshot: objects,
          canEdit: false,
          onGestureStart: started,
          onGestureEnd: ended,
        }),
        selection,
      };
    });
    const from = over(doc, a);

    act(() => {
      view.result.current.gesture.onObjectPointerDown(pointerDown(from) as PointerEvent, a);
    });
    flush();
    act(() => {
      move({ x: from.x + 100, y: from.y + 60 });
    });
    act(() => {
      release({ x: from.x + 100, y: from.y + 60 });
    });
    flush();

    expect(started).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    expect(boxOf(doc, a)).toEqual({ x: -100, y: -100, width: 200, height: 200 });
    expect(view.result.current.selection.ids.size).toBe(0);
  });
});
