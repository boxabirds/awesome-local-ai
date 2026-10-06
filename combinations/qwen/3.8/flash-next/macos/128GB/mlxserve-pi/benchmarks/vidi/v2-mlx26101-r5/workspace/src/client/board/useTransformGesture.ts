/**
 * One gesture, however many objects it moves.
 *
 * A press on an object can become four things: a click (select it), a move of the whole selection,
 * a resize of the whole selection through one of its handles, or nothing at all because the board
 * cannot be written to. This hook is the one place that decides between them, and it is on the
 * board rather than in the object because a gesture that starts on one sticky note has to move the
 * nineteen that were selected with it. Objects hand their pointer events to `onObjectPointerDown`
 * and the selection overlay hands its handles to `onHandlePointerDown`; nothing else writes a
 * position.
 *
 * Three rules hold it together:
 *
 * — **Absolute, not relative.** Every frame writes where the object *is*, worked out from where it
 *   was when the pointer went down and how far the pointer has travelled since. Two people dragging
 *   two different groups on one board therefore cannot wind up with a board that has drifted: an
 *   absolute position either arrived or it did not, and both copies end up in the same place. The
 *   starting rectangles are read from the document rather than from the picture on the screen, and
 *   they are read at the press rather than at the first move, so that two people who press the same
 *   object before either of them moves it both measure from the place it was in.
 *
 * — **One frame, one write.** Pointer moves arrive far faster than the network and faster than a
 *   document can be usefully updated, so a move only marks the session dirty and the write happens
 *   once per animation frame — with the last position kept even when the pointer leaves the object,
 *   because the pointer leaving the box is exactly what a drag does.
 *
 * — **Nothing is written that could not be read back.** A position that is not a number, an object
 *   that has been deleted mid-drag and a gesture on a board that cannot be written to all stop at
 *   the door, and a gesture that was never allowed to start never reports that it started.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';

import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  snapshot as readSnapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { keepsAspect, isResizableType, minSizeWorld } from '../objects/registry';
import type { Selection } from './useSelection';

/** Either kind of pointer event an object or a handle can be handed. */
export type ObjectPointerEvent = ReactPointerEvent<HTMLElement> | PointerEvent;

export interface TransformGestureOptions {
  /** The shared document the objects live in. */
  doc: Doc;
  /** The camera, for the one conversion this file does: screen movement to world movement. */
  camera: Camera;
  /** The board as it is now, which is where the objects' starting rectangles come from. */
  snapshot: readonly ObjectSnapshot[];
  /** The local selection: what a gesture moves. */
  selection: Selection;
  /** False while the board cannot be written to: a press selects and stops there. */
  canEdit: boolean;
  /**
   * Called once, when a gesture crosses the threshold and is allowed to write — before the first
   * write, so that whatever the person did just before this drag is not part of it.
   */
  onGestureStart?(): void;
  /**
   * Called once, when a gesture that started is over — however it ended, including a pointer the
   * system took back, which is the same shape of thing as a person letting go: the drag is over and
   * what it wrote is one step.
   */
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** The object under the pointer, before it became a drag: `data-interaction="pressed"`. */
  pressedId: string | null;
  /** The objects a gesture is moving right now. */
  movingIds: ReadonlySet<string>;
  /** An object was pressed. Also the one place shift-click is decided. */
  onObjectPointerDown(event: ObjectPointerEvent, id: string): void;
  /** A handle of the selection's bounding box was pressed. */
  onHandlePointerDown(event: ObjectPointerEvent, handle: Handle): void;
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

interface Session {
  pointerId: number;
  /** null for a move; the handle being dragged for a resize. */
  handle: Handle | null;
  /** True once the pointer has travelled far enough to be a drag rather than a press. */
  started: boolean;
  startClient: Point;
  lastClient: Point;
  /** The objects being moved, fixed the moment the pointer went down. */
  ids: string[];
  /** Where each of them was then, parallel to `ids`. */
  startRects: Rect[];
  /** The box they filled together, which is what a handle drag moves. */
  startBox: Rect | null;
  /** True when this drag keeps proportions: the object's own rule, or Shift. */
  aspect: boolean;
  frame: number | null;
  dirty: boolean;
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The scale a resize is allowed to reach: what the pointer asked for, stopped by the smallest object
 * in the selection and by the largest one.
 *
 * A drag that keeps proportions asked for one number and gets two, because the limits are per object
 * and per axis: a big note can shrink further than a small one, and one of them may be wider than it
 * is tall. The two are reconciled by picking the scale that is *further from where the drag started*,
 * in the direction the drag was going — shrinking, the bigger of the two; growing, the smaller. That
 * is the one scale that cannot put an object through its own minimum or its own maximum, whichever
 * limit was the one that answered.
 */
function allowedScale(
  wanted: Point,
  rects: readonly Rect[],
  minSizes: readonly number[],
  aspect: boolean,
): Point {
  const allowed = clampScale(wanted, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
  if (!aspect) return allowed;
  const shrinking = wanted.x < 1 || wanted.y < 1;
  const one = shrinking ? Math.max(allowed.x, allowed.y) : Math.min(allowed.x, allowed.y);
  return { x: one, y: one };
}

/** Screen pixels per world unit; a camera that is broken zooms at 1:1 rather than dividing by 0. */
const zoomOf = (camera: Camera): number =>
  finiteNumber(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const { doc, camera, snapshot, selection, canEdit, onGestureStart, onGestureEnd } = options;

  // Everything the window listeners touch arrives through a ref: the listeners are attached once
  // for the life of the board, and a stale camera or a stale selection would mean a drag that keeps
  // writing the position it remembered when the component first rendered.
  const docRef = useRef(doc);
  docRef.current = doc;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const objectsRef = useRef(snapshot);
  objectsRef.current = snapshot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const startedRef = useRef(onGestureStart);
  startedRef.current = onGestureStart;
  const endedRef = useRef(onGestureEnd);
  endedRef.current = onGestureEnd;

  const sessionRef = useRef<Session | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(NO_IDS);

  /** Writes what the pointer asked for, once. */
  const write = useCallback((session: Session) => {
    if (!session.dirty || !session.started) return;
    session.dirty = false;
    const scale = zoomOf(cameraRef.current);
    const dx = (session.lastClient.x - session.startClient.x) / scale;
    const dy = (session.lastClient.y - session.startClient.y) / scale;

    if (session.handle === null) {
      // A move: every object by the same world distance, from where it was when the drag started.
      const positions = new Map<string, Point>();
      session.ids.forEach((id, index) => {
        const start = session.startRects[index];
        if (start) positions.set(id, { x: start.x + dx, y: start.y + dy });
      });
      moveObjects(docRef.current, positions);
      return;
    }

    // A resize: the box the handle describes, stopped by the objects' own size limits, and then
    // every object mapped into it by the same scale so the layout scales with the box.
    const box = session.startBox;
    if (!box || box.width <= 0 || box.height <= 0) return;
    const asked = resizeRect(box, session.handle, { x: dx, y: dy }, session.aspect);
    const wanted = { x: asked.width / box.width, y: asked.height / box.height };
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    session.ids.forEach((id, index) => {
      const start = session.startRects[index];
      if (!start) return;
      rects.push(start);
      const object = objectsRef.current.find((candidate) => candidate.id === id);
      minSizes.push(object ? minSizeWorld(object.type) : start.width);
    });
    const target = scaleRect(box, session.handle, allowedScale(wanted, rects, minSizes, session.aspect));
    const rectsNow = new Map<string, Rect>();
    session.ids.forEach((id, index) => {
      const start = session.startRects[index];
      if (start) rectsNow.set(id, scaleWithin(start, box, target));
    });
    resizeObjects(docRef.current, rectsNow);
  }, []);

  const schedule = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.frame !== null) return; // at most one write per frame
    if (typeof requestAnimationFrame !== 'function') {
      write(session);
      return;
    }
    session.frame = requestAnimationFrame(() => {
      session.frame = null;
      // A frame that arrives after the gesture ended still writes the last position: the pointer
      // stopped moving where it stopped moving, whoever ended the gesture in between.
      write(session);
    });
  }, [write]);

  /**
   * The gesture is real. Nothing here is looked up again: the objects and their rectangles were
   * taken when the pointer went down, and all that is left is to say that the drag may write — and,
   * for a move, to put the group above everything it is not in one call rather than one per object.
   *
   * An object deleted between the press and the drag is not looked for again either: it keeps the
   * rectangle it started with, and the write that would have moved it is dropped by the model, which
   * is the answer the design gives to a note pulled out from under a drag.
   */
  const startDrag = useCallback((session: Session): boolean => {
    if (session.ids.length === 0) return false; // the objects that were pressed are all gone

    if (session.handle === null) {
      // Once, at the start of a move: the group comes above everything it is not. One call, so a
      // group of twenty rests the stacking once instead of twenty times.
      bringObjectsToFront(docRef.current, session.ids);
    }
    return true;
  }, []);

  /** Ends the gesture, flushing the position the pointer last showed. */
  const finishGesture = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    if (session.frame !== null && typeof cancelAnimationFrame === 'function') {
      // The queued frame is cancelled *after* the session is gone, so it cannot write twice; the
      // flush below is what keeps the position the pointer last showed.
      cancelAnimationFrame(session.frame);
      session.frame = null;
    }
    if (session.started) {
      write(session);
      setMovingIds(NO_IDS);
      endedRef.current?.();
    }
    setPressedId(null);
  }, [write]);

  // The pointer is followed on the window, in the capture phase, from the moment it goes down: the
  // object's own box is left behind by any drag worth the name, and a pointerup that happens over
  // the zoom control or outside the window still has to end the gesture.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!finiteNumber(event.clientX) || !finiteNumber(event.clientY)) return;
      // A drag in progress belongs to the objects being moved: it must never pan or zoom the board,
      // and the pointer is by now over anything at all.
      if (session.started) event.stopPropagation();
      session.lastClient = { x: event.clientX, y: event.clientY };
      if (!session.started) {
        const distance = Math.hypot(
          event.clientX - session.startClient.x,
          event.clientY - session.startClient.y,
        );
        // Still a press: not a write, not a restack, not a drag. Exactly the threshold is a drag.
        if (distance < DRAG_THRESHOLD_PX) return;
        // The person has started doing a thing. Whoever listens is told before the first write goes
        // in, so that the restack below and every frame of this drag are one step of the history and
        // the step before them — a nudge, a colour, the burst of typing that ended a moment ago —
        // stays a separate one. See `undo.boundaries`.
        startedRef.current?.();
        if (!startDrag(session)) {
          finishGesture();
          return;
        }
        session.started = true;
        setMovingIds(new Set(session.ids));
      }
      session.dirty = true;
      schedule();
    };

    const onPointerEnd = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (session.pointerId !== event.pointerId) return;
      if (session.started) event.stopPropagation();
      // pointerup and pointercancel are treated the same way here: a gesture interrupted by the
      // system keeps the last position it wrote, which is the position the person last saw.
      finishGesture();
    };

    const onBlur = () => {
      if (sessionRef.current) finishGesture();
    };

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [finishGesture, schedule, startDrag]);

  // A gesture that is still running when the board goes away ends without a write.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session?.frame != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(session.frame);
      }
    },
    [],
  );

  /**
   * Where these objects are, read from the document at the instant the pointer went down.
   *
   * Not from the picture on the screen: a colleague's write that landed a moment ago is in the
   * document and may not be drawn yet, and a drag measured against the drawing would move the object
   * by the difference. Two people pressing one note and pulling it two ways each measure from the
   * same starting place, and the board ends up in one of the two places they dragged to.
   */
  const pressSet = useCallback(
    (ids: Iterable<string>): readonly ObjectSnapshot[] => {
      const wanted = new Set(ids);
      return readSnapshot(docRef.current).filter((object) => wanted.has(object.id));
    },
    [],
  );

  const begin = useCallback(
    (event: ObjectPointerEvent, handle: Handle | null, picked: readonly ObjectSnapshot[]): void => {
      const rects = picked.map(objectBounds);
      sessionRef.current = {
        pointerId: event.pointerId,
        handle,
        started: false,
        startClient: { x: event.clientX, y: event.clientY },
        lastClient: { x: event.clientX, y: event.clientY },
        ids: picked.map((object) => object.id),
        startRects: rects,
        startBox: unionRects(rects),
        // Proportions: an object type that has to keep them, or Shift, which is the person saying so.
        aspect: event.shiftKey || picked.some((object) => keepsAspect(object.type)),
        frame: null,
        dirty: false,
      };
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (event: ObjectPointerEvent, id: string): void => {
      // Only the left button, and no browser shortcut pretending to be a press.
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      const selectionNow = selectionRef.current;
      if (selectionNow.editingId === id) return; // the object is open for editing: it is being typed into
      if (event.shiftKey) {
        // Shift-click adds or removes one object. It never drags: with Shift held the person is
        // choosing what is in the selection, not moving it.
        selectionNow.toggle(id);
        return;
      }
      // A press selects, so that the object answers immediately; pressing one that is already in a
      // bigger selection keeps the selection, because this is the press that drags the group.
      const wasSelected = selectionNow.ids.has(id);
      if (!wasSelected) selectionNow.click(id);
      if (!canEditRef.current) return; // nothing to write to: picking the object out is all there is
      // What this gesture moves is settled here, before the pointer has moved a pixel: the press set
      // is the selection when the object was already part of it, and this one object when it was not
      // — which is also what the click above has just made the selection.
      const picked = wasSelected ? pressSet(selectionNow.ids) : pressSet([id]);
      if (picked.length === 0) return; // the object is not on the board: there is nothing to press
      setPressedId(id);
      begin(event, null, picked);
    },
    [begin, pressSet],
  );

  const onHandlePointerDown = useCallback(
    (event: ObjectPointerEvent, handle: Handle): void => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      if (!canEditRef.current) return;
      const selectionNow = selectionRef.current;
      if (selectionNow.ids.size === 0) return;
      // A selection of nothing that can be resized has no resize: the overlay has already hidden the
      // handles, and a press that gets here by some other route is refused the same way.
      const resizable = objectsRef.current.some(
        (object) => selectionNow.ids.has(object.id) && isResizableType(object.type),
      );
      if (!resizable) return;
      begin(event, handle, pressSet(selectionNow.ids));
    },
    [begin, pressSet],
  );

  return useMemo(
    () => ({ pressedId, movingIds, onObjectPointerDown, onHandlePointerDown }),
    [pressedId, movingIds, onObjectPointerDown, onHandlePointerDown],
  );
}
