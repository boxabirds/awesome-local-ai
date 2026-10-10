import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
} from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  handleMovesLeft,
  handleMovesTop,
  resizeRect,
  scaleWithin,
  unionRects,
} from '../../shared/geometry';
import type { Handle, Point, Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Camera } from '../canvas/camera';
import type { SelectionController } from './useSelection';

/** Everything a frame or a window listener needs to read as it happens. */
interface Latest {
  readonly doc: Y.Doc;
  readonly camera: Camera;
  readonly selection: SelectionController;
  readonly snapshot: readonly ObjectSnapshot[];
  readonly canEdit: boolean;
  readonly onGestureStart?: () => void;
  readonly onGestureEnd?: () => void;
}

export interface TransformGestureOptions {
  /** Every change goes through this document, in one transaction per gesture. */
  readonly doc: Y.Doc;
  /** The camera, so screen pixels become the world units the board stores. */
  readonly camera: Camera;
  /** The selection this gesture acts on. */
  readonly selection: SelectionController;
  /** What the board can currently draw: the objects and their rectangles. */
  readonly snapshot: readonly ObjectSnapshot[];
  /** False while this client may not write to the board (`canEdit`). */
  readonly canEdit: boolean;
  /** Story 8's collaboration awareness: this client is moving something. */
  onGestureStart?(): void;
  /** …and it stopped (`sel.move_signal`). */
  onGestureEnd?(): void;
}

/** What the board calls when a pointer lands on an object or on a handle. */
export interface TransformGesture {
  /**
   * True while a move or resize is in progress: an object carries it as
   * `data-dragging`, and the selection bar hides itself while it is true
   * (story 2's TC-26), because chrome you cannot act on mid-drag is noise.
   */
  readonly dragging: boolean;
  /** Which objects are being moved or resized; the ones that show it. */
  readonly draggingIds: ReadonlySet<string>;
  /** pointerdown on an object: select it, and press through to a move. */
  onObjectPointerDown(event: ReactPointerEvent<Element>, id: string): void;
  /** pointerdown on one of the selection's eight resize handles. */
  onHandlePointerDown(event: ReactPointerEvent<Element>, handle: Handle): void;
}

/** One type's answers about itself, for the objects in this gesture. */
interface Spec {
  readonly minSize: number;
  readonly aspectLocked: boolean;
}

/** One press, from the pointer going down to it coming back up. */
interface Gesture {
  readonly pointerId: number;
  readonly kind: 'move' | 'resize';
  readonly handle: Handle;
  /** Where the pointer went down, in screen pixels. */
  readonly startX: number;
  readonly startY: number;
  /** True once the pointer passed `DRAG_THRESHOLD_PX`: a gesture, not a press. */
  started: boolean;
  /** Whether Shift is held right now, which locks the ratio of a resize. */
  shift: boolean;
  /** The objects, and where each was when the gesture began. */
  readonly ids: string[];
  readonly startRects: Map<string, Rect>;
  /** The selection's bounding box at gesture start — what a handle resizes. */
  readonly startBox: Rect;
  /** Each object's own minimum side and ratio rule, by index of `ids`. */
  readonly specs: Spec[];
  /** The latest pointer position; applied on the next frame. */
  pending: Point | null;
  frame: number | null;
}

/** The selected objects that are still on the board, and their rectangles. */
interface Measured {
  readonly ids: string[];
  readonly rects: Map<string, Rect>;
  readonly box: Rect | null;
  readonly specs: Spec[];
}

/**
 * Measure the selection at gesture start. Objects that are gone by the time the
 * pointer lands are left out, and the type registry answers what each remaining
 * object allows (`sel.size_limits`) — that is the only place a type says so.
 */
function measure(snapshot: readonly ObjectSnapshot[], ids: Iterable<string>): Measured {
  const wanted = new Set(ids);
  const picked = snapshot.filter((object) => wanted.has(object.id));
  const rects = new Map<string, Rect>();
  const specs: Spec[] = [];
  for (const object of picked) {
    rects.set(object.id, objectBounds(object));
    const spec = getObjectType(object.type);
    specs.push({ minSize: spec?.minSize ?? 0, aspectLocked: spec?.aspectLocked ?? false });
  }
  return {
    ids: picked.map((object) => object.id),
    rects,
    box: unionRects([...rects.values()]),
    specs,
  };
}

/**
 * The box a handle drag asks for, once its scale has been clamped: the anchor the
 * handle implies keeps its place, so a `nw` drag still holds the bottom-right
 * corner where it was (`resizeRect`'s rule, seen from the other side).
 */
function anchoredBox(start: Rect, handle: Handle, scale: Point): Rect {
  const width = start.width * scale.x;
  const height = start.height * scale.y;
  return {
    x: handleMovesLeft(handle) ? start.x + start.width - width : start.x,
    y: handleMovesTop(handle) ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

/** A box with two dimensions, which is what a handle needs to pull on. */
function resizable(box: Rect | null): box is Rect {
  return box !== null && box.width > 0 && box.height > 0;
}

/**
 * Write the selection where the pointer has taken it — from the *gesture-start*
 * copy plus the pointer's delta, never from the last written position, so a late
 * frame cannot make a cluster drift. One transaction per call, and objects
 * another person deleted in the meantime are skipped inside the board model.
 */
function applyGesture(latest: Latest, gesture: Gesture, at: Point): void {
  const zoom = latest.camera.zoom > 0 ? latest.camera.zoom : 1;
  const delta = { x: (at.x - gesture.startX) / zoom, y: (at.y - gesture.startY) / zoom };
  if (gesture.kind === 'move') {
    const positions = new Map<string, Point>();
    for (const [id, rect] of gesture.startRects) {
      positions.set(id, { x: rect.x + delta.x, y: rect.y + delta.y });
    }
    moveObjects(latest.doc, positions);
    return;
  }
  // One selection, one ratio rule: if any selected object must keep its
  // proportions, the box does, or the notes in it would stop being squares.
  // A type that must keep its proportions (a sticky note) locks the ratio for
  // the whole selection, and so does a person holding Shift — which is how you
  // keep the ratio of something the board would otherwise stretch freely.
  const aspectLocked = gesture.shift || gesture.specs.some((spec) => spec.aspectLocked);
  const target = resizeRect(gesture.startBox, gesture.handle, delta, aspectLocked);
  const scale = clampScale(
    {
      x: target.width / gesture.startBox.width,
      y: target.height / gesture.startBox.height,
    },
    [...gesture.startRects.values()],
    gesture.specs.map((spec) => spec.minSize),
    MAX_OBJECT_SIZE_WORLD,
  );
  const box = anchoredBox(gesture.startBox, gesture.handle, scale);
  const rects = new Map<string, Rect>();
  for (const [id, rect] of gesture.startRects) {
    const grown = scaleWithin(rect, gesture.startBox, box);
    // `clampScale` stopped the *box* at each object's minimum, so a note can
    // never shrink below `STICKY_MIN_SIZE_WORLD` here. The 1-unit floor is the
    // same rule for a type that declared no minimum of its own: an object with
    // no area is not an object, and the board model would refuse to write it.
    rects.set(id, {
      x: grown.x,
      y: grown.y,
      width: Math.max(grown.width, 1),
      height: Math.max(grown.height, 1),
    });
  }
  resizeObjects(latest.doc, rects);
}

/**
 * The frame coalescing story 2 used for one note, applied to a group: many
 * pointermoves, at most one write per frame, with `endGesture` writing the last
 * position synchronously so nobody has to wait a frame to see where they left it.
 */
function scheduleFrame(latest: Latest, gesture: Gesture, at: Point): void {
  gesture.pending = at;
  if (gesture.frame !== null) return;
  gesture.frame = requestAnimationFrame(() => {
    const pending = gesture.pending;
    gesture.pending = null;
    gesture.frame = null;
    if (pending) applyGesture(latest, gesture, pending);
  });
}

/**
 * Let go of a gesture: cancel its frame, optionally write what it had queued,
 * and tell the board it stopped (only once it had really started, so a press that
 * never moved the object does not announce a drag it did not perform).
 */
function endGesture(
  latest: Latest,
  gesture: Gesture,
  write: boolean,
  stop: () => void,
): void {
  if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
  gesture.frame = null;
  const pending = gesture.pending;
  gesture.pending = null;
  if (write && pending) applyGesture(latest, gesture, pending);
  if (!gesture.started) return;
  latest.onGestureEnd?.();
  stop();
}

/**
 * The one gesture that changes where objects are: press an object and the whole
 * selection follows the pointer; press a handle of the selection's bounding box
 * and every object scales inside it (`sel.group_move`, `sel.resize`).
 *
 * It is generic because it is written against `ObjectSnapshot` and the type
 * registry — minimum sides, whether proportions are locked — so it drives sticky
 * notes today and every later object type with nothing changed here, and Shift
 * joins them as a third way of saying "keep this shape". Nothing is
 * written until the pointer crosses `DRAG_THRESHOLD_PX`, which is what makes a
 * press select without moving (story 2's TC-19, story 7's TC-23), and while
 * `canEdit` is false the press selects but never moves: a board that could not be
 * loaded is read, not rearranged.
 */
export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const [dragging, setDragging] = useState(false);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set<string>());
  const latest = useRef<Latest>(options);
  latest.current = options;
  const gestureRef = useRef<Gesture | null>(null);

  const stop = useCallback(() => {
    setDragging(false);
    setDraggingIds(new Set<string>());
  }, []);

  /** Attach the window listeners this press needs, and only while it lasts. */
  const follow = useCallback(
    (gesture: Gesture): void => {
      const onPointerMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== gesture.pointerId) return;
        const at = { x: moveEvent.clientX, y: moveEvent.clientY };
        // Read on every move, so pressing or letting go of Shift mid-drag
        // changes what the same handle does from here on.
        gesture.shift = moveEvent.shiftKey;
        if (!gesture.started) {
          // Under the threshold it is still a press: nothing written, nothing
          // restacked, and no gesture announced (TC-23).
          if (Math.hypot(at.x - gesture.startX, at.y - gesture.startY) < DRAG_THRESHOLD_PX) return;
          gesture.started = true;
          setDragging(true);
          setDraggingIds(new Set(gesture.ids));
          latest.current.onGestureStart?.();
          // A moved cluster lands on top of what it covers, once, at the start
          // — and not at all when it is already on top (`sel.group_move`).
          if (gesture.kind === 'move') bringObjectsToFront(latest.current.doc, gesture.ids);
        }
        scheduleFrame(latest.current, gesture, at);
      };
      const finish = (event: PointerEvent, released: boolean): void => {
        if (event.pointerId !== gesture.pointerId) return;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        if (gestureRef.current === gesture) gestureRef.current = null;
        // An interrupted gesture keeps its last *applied* position, and later
        // events for the same press are ignored, because the press is over
        // (story 2's TC-21).
        endGesture(latest.current, gesture, released, stop);
      };
      const onPointerUp = (event: PointerEvent): void => {
        finish(event, true);
      };
      const onPointerCancel = (event: PointerEvent): void => {
        finish(event, false);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    },
    [stop],
  );

  const begin = useCallback(
    (
      event: ReactPointerEvent<Element>,
      kind: 'move' | 'resize',
      handle: Handle,
      ids: Iterable<string>,
    ): void => {
      const measured = measure(latest.current.snapshot, ids);
      if (measured.ids.length === 0) return;
      if (kind === 'resize' && !resizable(measured.box)) return;
      const gesture: Gesture = {
        pointerId: event.pointerId,
        kind,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        shift: event.shiftKey,
        ids: measured.ids,
        startRects: measured.rects,
        startBox: measured.box ?? { x: 0, y: 0, width: 0, height: 0 },
        specs: measured.specs,
        pending: null,
        frame: null,
      };
      gestureRef.current = gesture;
      follow(gesture);
    },
    [follow],
  );

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent<Element>, id: string): void => {
      const { selection } = latest.current;
      // Selecting is not writing, so it happens whatever the connection says.
      const selected = selection.ids;
      const alreadyIn = selected.has(id);
      let next: string[];
      if (event.shiftKey) {
        next = alreadyIn
          ? [...selected].filter((objectId) => objectId !== id)
          : [...selected, id];
        selection.toggle(id);
      } else if (alreadyIn) {
        // Pressing one object of a group and dragging moves the group; the press
        // on its own must not drop the rest of it.
        next = [...selected];
      } else {
        next = [id];
        selection.click(id);
      }
      if (!latest.current.canEdit) return;
      if (event.button !== 0) return;
      begin(event, 'move', 'se', next);
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<Element>, handle: Handle): void => {
      if (!latest.current.canEdit) return;
      if (event.button !== 0) return;
      // The handle is drawn over the objects; a drag on it must not also grab
      // whatever sits underneath.
      event.stopPropagation();
      begin(event, 'resize', handle, latest.current.selection.ids);
    },
    [begin],
  );

  // A board that stops being writable mid-gesture (the room went away) lets go of
  // it where it is: the last written position stands, and nothing further is.
  useEffect(() => {
    if (options.canEdit) return;
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    endGesture(latest.current, gesture, true, stop);
  }, [options.canEdit, stop]);

  // A gesture that outlived its board (a board id change, an unmount) must not
  // write to a document nobody is showing.
  useEffect(
    () => () => {
      const gesture = gestureRef.current;
      if (gesture && gesture.frame !== null) cancelAnimationFrame(gesture.frame);
      gestureRef.current = null;
    },
    [],
  );

  return { dragging, draggingIds, onObjectPointerDown, onHandlePointerDown };
}
