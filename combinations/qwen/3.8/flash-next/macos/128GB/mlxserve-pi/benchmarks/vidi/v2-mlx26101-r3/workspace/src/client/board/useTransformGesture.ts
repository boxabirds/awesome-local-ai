import { useCallback, useEffect, useRef } from 'react';
import type { Doc } from 'yjs';
import type { Camera } from '../canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  selectionBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  clampScale,
  resizeAnchor,
  resizeRect,
  scaleRect,
  scaleWithin,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { getObjectType, type ObjectPointerEvent } from '../objects/registry';
import type { MultiSelection } from './useSelection';

/** The two ways a pointer on the board can move something. */
type Mode = 'move' | 'resize';

/** The handle a move gesture is recorded with: it carries no box, so the name is a formality. */
const MOVE_HANDLE: Handle = 'se';

/** What a gesture is doing: where it started, and what it is carrying. */
interface Running {
  pointerId: number;
  mode: Mode;
  handle: Handle;
  /** The objects being carried: the selection at the moment of the grab. */
  ids: string[];
  /** Of those, the ones whose size this gesture may change: a resize writes only these. */
  writable: Set<string>;
  /** Where the pointer went down, in client pixels. */
  clientX: number;
  clientY: number;
  /** Where each object was when the gesture started, in world units. */
  startRects: Map<string, Rect>;
  /** The selection's bounding box when it started. */
  box: Rect;
  /** The point of that box a resize turns about. */
  anchor: Point;
  /** The boxes and minimum sizes the scale is clamped against, index for index. */
  rects: Rect[];
  minSizes: number[];
  /** Whether the proportions of the box are held. */
  aspect: boolean;
  /** True once the pointer has travelled enough for this to be a drag and not a click. */
  dragging: boolean;
  /** The movement the next frame will write, in world units. */
  delta: Point | null;
  frame: number | null;
  element: HTMLElement | null;
}

interface Listeners {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
}

export interface TransformGesture {
  /** A press on an object: selects it, and may start a group move. */
  onObjectPointerDown(event: ObjectPointerEvent, id: string): void;
  /** A press on one of the selection's eight resize handles: may start a group resize. */
  onHandlePointerDown(event: ObjectPointerEvent, handle: Handle): void;
  /** Pointer capture taken away from an object: the end of a gesture in some browsers. */
  onObjectLostPointerCapture(event: ObjectPointerEvent, id: string): void;
}

export interface TransformGestureOptions {
  doc: Doc;
  camera: Camera;
  /** The board's objects; the ones selected are the ones carried. */
  snapshot: readonly ObjectSnapshot[];
  selection: MultiSelection;
  /** Whether the board may be written to at all. */
  canEdit: boolean;
  /**
   * A gesture began changing the document. Story 8's undo opens a group here, so that moving
   * nine notes is one thing to undo and not nine.
   */
  onGestureStart?(): void;
  /** The gesture is over, however it ended. */
  onGestureEnd?(): void;
  /** Which objects are being carried, so they can say so while it lasts. */
  onTransformingChange(ids: readonly string[], transforming: boolean): void;
}

/** Take the pointer, so that its moves and its end arrive here wherever on the screen it goes. */
function capturePointer(element: HTMLElement | null, pointerId: number): void {
  try {
    element?.setPointerCapture(pointerId);
  } catch {
    // setPointerCapture throws if the pointer is already gone
  }
}

function releasePointer(element: HTMLElement | null, pointerId: number): void {
  try {
    if (element !== null && element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Already released: the gesture is ending either way.
  }
}

/**
 * Moving and resizing board objects with the pointer: one hook for one object or for a hundred.
 *
 * Three things make this more than "set the position to where the pointer is":
 *
 * - **Every write is absolute, from where the object was when the gesture started.** Half a
 *   second of a drag is a hundred writes; summing the movements between frames would add up to
 *   something different on every screen as soon as somebody else moves the same object, and the
 *   boards would drift apart. `start + delta` from a remembered start is the same number on
 *   every screen, which is what lets a board with five people on it still be one board.
 * - **One write per frame, and the last one at the end.** The pointer reports far more often
 *   than a screen can show, and every write is a change sent to everybody. Positions are applied
 *   on the next animation frame, and the final position is applied on pointerup without waiting,
 *   so an object lands under the pointer rather than one frame short of it.
 * - **The gesture is a *group*.** Whatever was selected when the press happened is what moves -
 *   each object from its own start box - and a whole group resize is one scale applied to all of
 *   them, clamped once for the whole selection so that nothing stops short of the others and the
 *   arrangement comes out skewed.
 *
 * A press that never travels is a select and writes nothing at all; a gesture interrupted
 * (pointercancel, the pointer taken away) keeps the last position it applied rather than
 * inventing a new one.
 */
export function useTransformGesture({
  doc,
  camera,
  snapshot,
  selection,
  canEdit,
  onGestureStart,
  onGestureEnd,
  onTransformingChange,
}: TransformGestureOptions): TransformGesture {
  const runningRef = useRef<Running | null>(null);
  const listenersRef = useRef<Listeners | null>(null);
  // The latest props, for listeners that are added to the window once and kept.
  const cameraRef = useRef(camera);
  const objectsRef = useRef(snapshot);
  const selectionRef = useRef(selection);
  const canEditRef = useRef(canEdit);
  const callbacksRef = useRef({ onGestureStart, onGestureEnd, onTransformingChange });
  useEffect(() => {
    cameraRef.current = camera;
    objectsRef.current = snapshot;
    selectionRef.current = selection;
    canEditRef.current = canEdit;
    callbacksRef.current = { onGestureStart, onGestureEnd, onTransformingChange };
  });

  /** Stop listening, let go of the pointer, forget the gesture. Callbacks are the caller's. */
  const stop = useCallback((): void => {
    const running = runningRef.current;
    const listeners = listenersRef.current;
    if (listeners !== null) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.up);
      window.removeEventListener('pointercancel', listeners.cancel);
      listenersRef.current = null;
    }
    if (running !== null) {
      releasePointer(running.element, running.pointerId);
      if (running.frame !== null) {
        cancelAnimationFrame(running.frame);
        running.frame = null;
      }
      running.delta = null;
    }
    runningRef.current = null;
  }, []);

  /** The end of a gesture that had begun: say so, once, and stop saying it. */
  const finish = useCallback((): void => {
    const wasDragging = runningRef.current !== null && runningRef.current.dragging;
    stop();
    if (wasDragging) {
      callbacksRef.current.onTransformingChange([], false);
      callbacksRef.current.onGestureEnd?.();
    }
  }, [stop]);

  /** Write where the objects are now, given the pointer's movement from where it started. */
  const apply = useCallback((): void => {
    const running = runningRef.current;
    const delta = running?.delta ?? null;
    if (running === null || delta === null) {
      return;
    }
    if (!canEditRef.current) {
      // A drag that was underway when the board stopped being editable stops being a drag here:
      // the position it would write is a position on a board nobody knows the state of.
      return;
    }
    // Objects other people deleted while this gesture has been running are left alone -
    // not moved, not resized, and certainly not brought back.
    const present = new Set(objectsRef.current.map((object) => object.id));
    if (running.ids.some((id) => !present.has(id))) {
      running.ids = running.ids.filter((id) => present.has(id));
      callbacksRef.current.onTransformingChange(running.ids, true);
      if (running.ids.length === 0) {
        return;
      }
    }

    if (running.mode === 'move') {
      const positions = new Map<string, Point>();
      for (const id of running.ids) {
        const start = running.startRects.get(id);
        if (start !== undefined) {
          positions.set(id, { x: start.x + delta.x, y: start.y + delta.y });
        }
      }
      moveObjects(doc, positions);
      return;
    }

    // A resize: the box the handles had, scaled by how far the handle was dragged, and then that
    // one scale handed to every object inside it. Clamping the scale once - instead of clamping
    // each object's size - is what keeps a group resize a group resize.
    const raw = resizeRect(running.box, running.handle, delta, running.aspect);
    let scaleX = running.box.width > 0 ? raw.width / running.box.width : 1;
    let scaleY = running.box.height > 0 ? raw.height / running.box.height : 1;
    const clamped = clampScale(
      { x: scaleX, y: scaleY },
      running.rects,
      running.minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    scaleX = clamped.x;
    scaleY = clamped.y;
    if (running.aspect && scaleX !== scaleY) {
      // The two axes no longer agree, because one of them hit a limit first: that one wins, so
      // the proportions hold and nothing is left bigger than it is allowed to be.
      const wanted = running.box.width > 0 ? raw.width / running.box.width : 1;
      const scale = wanted > 1 ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
      scaleX = scale;
      scaleY = scale;
    }
    const to = scaleRect(running.box, { x: scaleX, y: scaleY }, running.anchor);
    const rects = new Map<string, Rect>();
    for (const id of running.ids) {
      if (!running.writable.has(id)) {
        // A type with no size to change is left where it is, inside a box that scaled without it.
        continue;
      }
      const start = running.startRects.get(id);
      if (start !== undefined) {
        // Position and size both follow the box, so the gaps between objects scale with it.
        rects.set(id, scaleWithin(start, running.box, to));
      }
    }
    resizeObjects(doc, rects);
  }, [doc]);

  const schedule = useCallback((): void => {
    const running = runningRef.current;
    if (running === null || running.frame !== null) {
      return;
    }
    running.frame = requestAnimationFrame(() => {
      const current = runningRef.current;
      if (current !== null) {
        current.frame = null;
      }
      apply();
    });
  }, [apply]);

  /** The pointer moved: either this is still a click, or the gesture is now moving things. */
  const move = useCallback(
    (event: PointerEvent): void => {
      const running = runningRef.current;
      if (running === null || event.pointerId !== running.pointerId) {
        return;
      }
      const screenX = event.clientX - running.clientX;
      const screenY = event.clientY - running.clientY;
      const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
      if (!running.dragging) {
        // Two pixels of jitter must not move an object: the threshold decides when a press
        // becomes a drag, so a click on a small object still works.
        if (Math.hypot(screenX, screenY) < DRAG_THRESHOLD_PX) {
          return;
        }
        running.dragging = true;
        callbacksRef.current.onGestureStart?.();
        callbacksRef.current.onTransformingChange(running.ids, true);
        if (running.mode === 'move') {
          // The selection comes to the front as it is grabbed, so it is never dragged out of
          // sight behind the objects that stayed behind.
          bringObjectsToFront(doc, running.ids);
        }
      }
      running.delta = { x: screenX / zoom, y: screenY / zoom };
      schedule();
    },
    [doc, schedule],
  );

  /** Watch the pointer wherever it goes, and carry the objects with it. */
  const watch = useCallback(
    (element: HTMLElement | null): void => {
      const pointerId = runningRef.current?.pointerId ?? -1;
      const moveHandler = (event: PointerEvent): void => {
        move(event);
      };
      const upHandler = (event: PointerEvent): void => {
        const running = runningRef.current;
        if (running === null || event.pointerId !== running.pointerId) {
          return;
        }
        if (running.dragging && running.delta !== null) {
          // Finish where the pointer stopped, rather than one frame short of it.
          if (running.frame !== null) {
            cancelAnimationFrame(running.frame);
            running.frame = null;
          }
          apply();
        }
        finish();
      };
      const cancelHandler = (event: PointerEvent): void => {
        const running = runningRef.current;
        if (running === null || event.pointerId !== running.pointerId) {
          return;
        }
        // Interrupted: the objects stay where they were last put. A gesture that never got past
        // being a press never started, so it has nothing to end either.
        finish();
      };
      window.addEventListener('pointermove', moveHandler);
      window.addEventListener('pointerup', upHandler);
      window.addEventListener('pointercancel', cancelHandler);
      listenersRef.current = { move: moveHandler, up: upHandler, cancel: cancelHandler };
      capturePointer(element, pointerId);
    },
    [apply, finish, move],
  );

  /** Record where everything is, and start following the pointer. */
  const prepare = useCallback(
    (
      pointerId: number,
      event: ObjectPointerEvent,
      element: HTMLElement | null,
      mode: Mode,
      handle: Handle,
      ids: readonly string[],
      writable: readonly string[],
      aspect: boolean,
    ): void => {
      const byId = new Map(objectsRef.current.map((object) => [object.id, object]));
      const startRects = new Map<string, Rect>();
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      for (const id of ids) {
        const object = byId.get(id);
        if (object === undefined) {
          continue;
        }
        const rect = objectBounds(object);
        startRects.set(id, rect);
        if (writable.includes(id)) {
          // The clamp is asked about the sizes that are actually going to change: an object that
          // is only along for the ride has no say in how far the box may go.
          rects.push(rect);
          minSizes.push(getObjectType(object.type)?.minSize ?? 0);
        }
      }
      const box = selectionBounds(objectsRef.current, startRects.keys());
      if (box === null || box.width <= 0 || box.height <= 0) {
        return;
      }
      const pointer = 'clientX' in event ? event : { clientX: 0, clientY: 0 };
      runningRef.current = {
        pointerId,
        mode,
        handle,
        ids: [...startRects.keys()],
        writable: new Set(writable.filter((id) => startRects.has(id))),
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        startRects,
        box,
        anchor: resizeAnchor(handle, box),
        rects,
        minSizes,
        aspect,
        dragging: false,
        delta: null,
        frame: null,
        element,
      };
      watch(element);
    },
    [watch],
  );

  const elementOf = (event: ObjectPointerEvent): HTMLElement | null =>
    'currentTarget' in event && event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;

  const onObjectPointerDown = useCallback(
    (event: ObjectPointerEvent, id: string): void => {
      const selectionNow = selectionRef.current;
      if ('shiftKey' in event && event.shiftKey) {
        // Shift + press adds an object to the selection, or takes it back out. It is not a way
        // to start a drag: Shift + drag belongs to the marquee, and a drag that added to the
        // selection on the way would be two things happening at once.
        selectionNow.toggle(id);
        return;
      }
      if (!selectionNow.ids.has(id)) {
        // A press on an object that is not part of the selection selects it and only it; the
        // objects already selected do not come along for the ride.
        selectionNow.click(id);
      }
      if (!canEditRef.current) {
        // Selected, and that is as far as it goes: no reorder, no grab, nothing to write.
        return;
      }
      if ('pointerType' in event && event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const ids = selectionNow.ids.has(id) ? [...selectionNow.ids] : [id];
      prepare(
        'pointerId' in event ? event.pointerId : 1,
        event,
        elementOf(event),
        'move',
        MOVE_HANDLE,
        ids,
        ids,
        false,
      );
    },
    [prepare],
  );

  const onHandlePointerDown = useCallback(
    (event: ObjectPointerEvent, handle: Handle): void => {
      if (!canEditRef.current) {
        return;
      }
      const selectionNow = selectionRef.current;
      const byId = new Map(objectsRef.current.map((object) => [object.id, object]));
      const present = [...selectionNow.ids].filter((id) => byId.has(id));
      const spec = (id: string): ReturnType<typeof getObjectType> =>
        getObjectType(byId.get(id)?.type ?? '');
      // The box that is scaled is the box that is drawn - the whole selection, including anything
      // whose type has no size to change. But only the objects that can be resized are written,
      // and only they are asked what their minimum size is.
      const writable = present.filter((id) => spec(id)?.resizable === true);
      if (writable.length === 0) {
        // A type that cannot be resized has no handles to press; a press on handles that were left
        // on screen from a selection that has since changed goes nowhere.
        return;
      }
      // Holding Shift holds the proportions, the same way a type that keeps them anyway does:
      // the modifier is what the person asked for, the spec is what the object is.
      const aspect =
        writable.some((id) => spec(id)?.aspectLocked === true) ||
        ('shiftKey' in event && event.shiftKey);
      prepare(
        'pointerId' in event ? event.pointerId : 1,
        event,
        elementOf(event),
        'resize',
        handle,
        present,
        writable,
        aspect,
      );
    },
    [prepare],
  );

  const onObjectLostPointerCapture = useCallback(
    (event: ObjectPointerEvent, id: string): void => {
      void id;
      const running = runningRef.current;
      if (running === null || !('pointerId' in event) || event.pointerId !== running.pointerId) {
        return;
      }
      if ('buttons' in event && event.buttons !== 0) {
        // Capture came and went in the middle of the gesture: bringing a selection to the front
        // moved its elements, and the browser took capture back with it. The pointer is still
        // down, so this is not the end of the drag; the window listeners carry on with it.
        return;
      }
      // The pointer is gone without a pointerup (the browser took it away): as with a cancel.
      finish();
    },
    [finish],
  );

  // A gesture that outlives the board it started on - the component unmounted, the address moved
  // to another board - must not leave a window listener or a pending frame behind.
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  return { onObjectPointerDown, onHandlePointerDown, onObjectLostPointerCapture };
}
