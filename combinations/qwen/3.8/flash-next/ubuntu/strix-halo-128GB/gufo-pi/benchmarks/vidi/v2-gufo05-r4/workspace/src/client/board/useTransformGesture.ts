/**
 * The one gesture that transforms board objects: drag an object to move the whole
 * selection, drag a handle to resize it (`sel.group_move`, `sel.resize`).
 *
 * Two rules hold it together.
 *
 * **Absolute writes.** A gesture records where every selected object was when it began
 * and, on each frame, writes `start + delta` (or the box-scaled rect) rather than
 * nudging what is there now. Accumulating per-frame deltas drifts when a remote person
 * moves the same object in between, and two screens would settle in two places; writing
 * the same absolute position each frame converges to one, whoever else is writing (`sel.transform`, key decision 1).
 *
 * **One scale for the whole selection.** A resize works on the selection's bounding box:
 * the handle asks for a scale, that scale is clamped once against every object's minimum
 * and the global maximum, and the clamped scale is applied to every object. Objects
 * therefore stop moving at the same moment — the selection stops where its first object
 * reaches its limit — instead of each stopping on its own and the layout distorting
 * (key decision 2).
 *
 * The pointer listeners live on `window` for the length of the gesture only. That is what
 * lets a drag continue when the pointer leaves the object, and it is why a component only
 * has to hand its `pointerdown` to `onObjectPointerDown` to be movable — which is exactly
 * the promise stories 9 to 12 rely on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Doc } from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  anchorScaleRect,
  clampScale,
  resizeScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect
} from '../../shared/geometry';
import type { SelectionControls } from './useSelection';
import { minSizeOf, selectionIsAspectLocked, selectionIsResizable, type ObjectGestureHandlers, type PointerLike } from '../objects/registry';

export interface TransformGesture {
  /** Press on an object: select it if it is not selected, then maybe move the selection. */
  onObjectPointerDown(event: PointerLike, id: string): void;
  /** Press on one of the selection's eight handles: resize the selection. */
  onHandlePointerDown(event: PointerLike, handle: Handle): void;
  /** The objects a move or resize is running on, empty while idle. */
  readonly transforming: ReadonlySet<string>;
}

export interface TransformGestureOptions {
  doc: Doc;
  /** Only the zoom is used: a pointer delta in screen pixels is `/ zoom` board units. */
  camera: { zoom: number };
  selection: SelectionControls;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * Called once when a gesture starts moving and once when it finishes. Story 8 wraps
   * what happens between them in a single undo step, which is why they are here rather
   * than inside the document writes.
   */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/** What the window listeners are told about on every pointer move. */
interface PointerInfo {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
}

/** A gesture in progress, and everything absolute about it. */
interface Running {
  kind: 'move' | 'resize';
  pointerId: number;
  /** The zoom the gesture was measured against, so one delta stays one distance. */
  zoom: number;
  originX: number;
  originY: number;
  ids: string[];
  /** Where each selected object was when the gesture began. */
  start: Map<string, Rect>;
  /** The selection's bounding box at the same moment. */
  box: Rect;
  handle: Handle;
  /** Does a type in the selection force the proportions to be kept? */
  lockedToTypes: boolean;
  /** Past the drag threshold yet? */
  moved: boolean;
  /** Did this gesture announce itself? `onGestureStart` and `onGestureEnd` come in pairs. */
  started: boolean;
  /** The board was writable when the press began; a gesture never changes its mind. */
  writable: boolean;
  pending: PointerInfo;
  frame: number | null;
}

const NO_OBJECTS: ReadonlySet<string> = new Set<string>();

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const latest = useRef(options);
  latest.current = options;

  const runningRef = useRef<Running | null>(null);
  const transformingRef = useRef<ReadonlySet<string>>(NO_OBJECTS);
  const [transforming, setTransforming] = useState<ReadonlySet<string>>(NO_OBJECTS);

  const setTransformingTo = useCallback((ids: readonly string[] | null) => {
    const next = ids === null ? NO_OBJECTS : new Set(ids);
    if (next === transformingRef.current) return;
    transformingRef.current = next;
    setTransforming(next);
  }, []);

  /** The objects of this gesture that are still on the board, with where they started. */
  const startRects = (ids: readonly string[]): Map<string, Rect> => {
    const present = new Map(latest.current.snapshot.map((object) => [object.id, object] as const));
    const rects = new Map<string, Rect>();
    for (const id of ids) {
      const object = present.get(id);
      if (object) rects.set(id, objectBounds(object));
    }
    return rects;
  };

  /** Write this frame's move: every object where it started, plus the pointer's delta. */
  const applyMove = (run: Running): void => {
    const dx = (run.pending.clientX - run.originX) / run.zoom;
    const dy = (run.pending.clientY - run.originY) / run.zoom;
    const positions = new Map<string, Point>();
    for (const [id, rect] of run.start) positions.set(id, { x: rect.x + dx, y: rect.y + dy });
    moveObjects(latest.current.doc, positions);
  };

  /** Write this frame's resize: the box scaled by the handle, and every object with it. */
  const applyResize = (run: Running): void => {
    const dx = (run.pending.clientX - run.originX) / run.zoom;
    const dy = (run.pending.clientY - run.originY) / run.zoom;
    // `sel.aspect`: a type that must keep its proportions, or a hand on Shift.
    const aspectLocked = run.lockedToTypes || run.pending.shiftKey;
    const asked = resizeScale(run.box, run.handle, { x: dx, y: dy }, aspectLocked);
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    const present = new Map(latest.current.snapshot.map((object) => [object.id, object] as const));
    for (const [id, rect] of run.start) {
      const object = present.get(id);
      if (!object) continue;
      rects.push(rect);
      minSizes.push(minSizeOf(object.type));
    }
    const scale = clampScale(asked, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = anchorScaleRect(run.box, run.handle, scale);
    const next = new Map<string, Rect>();
    for (const [id, rect] of run.start) next.set(id, scaleWithin(rect, run.box, to));
    resizeObjects(latest.current.doc, next);
  };

  const apply = (run: Running): void => {
    if (!run.writable) return;
    if (run.kind === 'move') applyMove(run);
    else applyResize(run);
  };

  const stopFrame = (run: Running): void => {
    if (run.frame === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(run.frame);
    else clearTimeout(run.frame);
    run.frame = null;
  };

  /** At most one document write per animation frame, however many moves arrive. */
  const schedule = (run: Running): void => {
    if (run.frame !== null) return;
    const run_frame = () => {
      const current = runningRef.current;
      if (!current || current !== run) return;
      current.frame = null;
      apply(current);
    };
    run.frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(run_frame)
        : (setTimeout(run_frame, 0) as unknown as number);
  };

  const endGesture = useCallback(
    (info: PointerInfo | null, applyLast: boolean) => {
      const run = runningRef.current;
      if (!run) return;
      if (info) run.pending = info;
      stopFrame(run);
      // The last position is written here rather than in a frame, so the object ends
      // exactly under the pointer. An interrupted gesture keeps its last applied frame.
      if (run.moved && applyLast) apply(run);
      runningRef.current = null;
      setTransformingTo(null);
      if (run.started) latest.current.onGestureEnd?.();
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
    },
    // The handlers below are referenced by identity; both are stable useCallbacks.
    [setTransformingTo]
  );

  /** The first move past the threshold is the gesture: everything else was a click. */
  const begin = (run: Running, info: PointerInfo): void => {
    run.moved = true;
    setTransformingTo(run.ids);
    if (!run.writable) return; // story 4: the drag stays a look, nothing is written
    // Announce the gesture *before* its first write, so the undo history closes the
    // previous step here and everything this drag does — the raise and every position —
    // lands as one step (story 8, `undo.drag`).
    run.started = true;
    latest.current.onGestureStart?.();
    if (run.kind === 'move') bringObjectsToFront(latest.current.doc, run.ids);
    run.pending = info;
    apply(run);
  };

  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    const run = runningRef.current;
    if (!run || run.pointerId !== event.pointerId) return;
    const info: PointerInfo = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
    if (!run.moved) {
      // A short press without movement stays a selection, not a drag.
      if (Math.hypot(info.clientX - run.originX, info.clientY - run.originY) < DRAG_THRESHOLD_PX) return;
      begin(run, info);
    }
    run.pending = info;
    schedule(run);
  }, []);

  const onWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const run = runningRef.current;
      if (!run || run.pointerId !== event.pointerId) return;
      endGesture({ clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }, true);
    },
    [endGesture]
  );

  const onWindowPointerCancel = useCallback(
    (event: PointerEvent) => {
      const run = runningRef.current;
      if (!run || run.pointerId !== event.pointerId) return;
      endGesture(null, false);
    },
    [endGesture]
  );

  const startListening = (): void => {
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
  };

  const press = useCallback(
    (event: PointerLike, ids: string[], kind: 'move' | 'resize', handle: Handle) => {
      const { snapshot } = latest.current;
      const start = startRects(ids);
      if (start.size === 0) return;
      const box = unionRects([...start.values()]);
      if (!box) return;
      const types = snapshot.filter((object) => start.has(object.id)).map((object) => object.type);
      runningRef.current = {
        kind,
        pointerId: event.pointerId,
        zoom: latest.current.camera.zoom > 0 ? latest.current.camera.zoom : 1,
        originX: event.clientX,
        originY: event.clientY,
        ids: [...start.keys()],
        start,
        box,
        handle,
        lockedToTypes: selectionIsAspectLocked(types),
        moved: false,
        started: false,
        writable: latest.current.canEdit,
        pending: { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey },
        frame: null
      };
      startListening();
      // The object is not yet rendered as "moving": that happens past the threshold.
    },
    [onWindowPointerMove, onWindowPointerUp, onWindowPointerCancel]
  );

  const onObjectPointerDown = useCallback(
    (event: PointerLike, id: string): void => {
      // An object owns its own pointer events: the board must never pan under a drag.
      event.stopPropagation();
      if (event.button !== 0) return;
      const { selection } = latest.current;
      if (selection.editingId === id) return; // placing the caret is not a press on the object

      if (event.shiftKey) {
        // Shift is the add-or-remove key; a Shift press never drags (`sel.shift_toggle`).
        selection.toggle(id);
        return;
      }
      // Dragging an object that is not selected selects only it, and so moves only it
      // (`sel.drag_unselected`). One that is already selected drags the whole selection.
      const ids = selection.ids.has(id) ? [...selection.ids] : [id];
      if (!selection.ids.has(id)) selection.click(id);
      press(event, ids, 'move', 'se');
    },
    [press]
  );

  const onHandlePointerDown = useCallback(
    (event: PointerLike, handle: Handle): void => {
      event.stopPropagation();
      if (event.button !== 0) return;
      const { selection, snapshot } = latest.current;
      const ids = [...selection.ids];
      const types = snapshot.filter((object) => selection.ids.has(object.id)).map((object) => object.type);
      // Handles are not shown for a type that cannot be resized; if one is pressed
      // anyway — a stale render, a type that changed underneath — nothing happens.
      if (ids.length === 0 || !selectionIsResizable(types)) return;
      press(event, ids, 'resize', handle);
    },
    [press]
  );

  // A gesture must not outlive the board it started on. If the screen goes away mid-drag
  // — a room that fails to load, a board that changes identity, a note deleted under the
  // pointer — the window listeners go with it, rather than carrying on writing into a
  // document nobody is looking at.
  const endRef = useRef(endGesture);
  endRef.current = endGesture;
  useEffect(
    () => () => {
      if (runningRef.current) endRef.current(null, false);
    },
    []
  );

  return { onObjectPointerDown, onHandlePointerDown, transforming };
}

/** The gesture handlers an object component is handed (`ObjectComponentProps.gesture`). */
export type { ObjectGestureHandlers };
