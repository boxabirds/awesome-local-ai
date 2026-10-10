import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  resizeRectFromScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import {
  getObjectType,
  selectionIsAspectLocked,
  selectionIsResizable,
  selectionMinSizes,
  type PointerEventLike,
} from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * The one gesture every board object shares (anchor `sel.transform`).
 *
 * A press on an object, or on a resize handle, becomes a **move** or a
 * **resize**. Everything about it lives here, so stories 9-12 add object types
 * without ever writing interaction code again (`sel.all_types`):
 *
 * - a press on an unselected object selects just that object first
 *   (`sel.drag_unselected`);
 * - the gesture only starts past `DRAG_THRESHOLD_PX`, the story 2 rule, so a
 *   press that barely moves is still a click (TC-19);
 * - every frame writes **absolute** rects - `start + delta` - never
 *   `current + this frame` (Key decision 1), so a concurrent remote move of the
 *   same object converges instead of accumulating drift;
 * - writes are coalesced to one per animation frame, one transaction per frame;
 * - a cancelled gesture keeps the last applied position and drops what was
 *   still queued (TC-21);
 * - `onGestureStart` / `onGestureEnd` fire exactly once per gesture, which is
 *   where story 8 will cut its undo boundaries (TC-26).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Pressed : pointerdown on object or handle
 *     Pressed --> Idle : pointerup under DRAG_THRESHOLD_PX
 *     Pressed --> Moving : move beyond threshold on object
 *     Pressed --> Resizing : move beyond threshold on handle
 *     Moving --> Idle : pointerup or pointercancel
 *     Resizing --> Idle : pointerup or pointercancel
 * ```
 */
export interface TransformGestureOptions {
  doc: Y.Doc;
  /** The camera, for the one thing the gesture needs from it: zoom. */
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  /** False when the room could not load this board: the gesture writes nothing. */
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** A component forwards its pointerdown here (`ObjectProps`). */
  onObjectPointerDown(event: PointerEventLike, id: string): void;
  /** `SelectionOverlay` forwards a handle press here. */
  onHandlePointerDown(event: PointerEventLike, handle: Handle): void;
  /** The ids a gesture is transforming right now, for `data-dragging`. */
  activeIds: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

type GestureKind = 'move' | 'resize';

interface ActiveGesture {
  kind: GestureKind;
  pointerId: number;
  /** Where the pointer went down: every delta is measured from here. */
  startX: number;
  startY: number;
  handle: Handle | null;
  /** What this gesture transforms: the whole selection, or the one pressed id. */
  ids: string[];
  /** Captured at the threshold crossing: the absolute base of every write. */
  startRects: Map<string, Rect> | null;
  startBox: Rect | null;
  /** A selected type that keeps its proportions (Key decision 3). */
  aspectLocked: boolean;
  /** Past `DRAG_THRESHOLD_PX` yet? */
  moved: boolean;
  /** Shift held during the drag: locks the ratio even for a free type. */
  shiftKey: boolean;
  pending: Point | null;
  frame: number | null;
}

const typeLookup = (
  snapshot: readonly ObjectSnapshot[],
): ((id: string) => string) => {
  const types = new Map<string, string>();
  for (const obj of snapshot) {
    types.set(obj.id, obj.type);
  }
  return (id: string) => types.get(id) ?? '';
};

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const { doc, camera, selection, snapshot, canEdit } = options;

  // The window listeners below live for the whole mount, so they read their
  // inputs through a ref: they always see the current camera, selection and
  // snapshot without being re-attached on every render.
  const inputs = useRef({ doc, camera, selection, snapshot, canEdit, options });
  inputs.current = { doc, camera, selection, snapshot, canEdit, options };

  const gestureRef = useRef<ActiveGesture | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(NO_IDS);

  const cancelFrame = (gesture: ActiveGesture): void => {
    if (gesture.frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(gesture.frame);
    }
    gesture.frame = null;
  };

  /** The gesture truly began: capture the base rects and raise the group. */
  const startGesture = (gesture: ActiveGesture): void => {
    const { snapshot: current } = inputs.current;
    const rects = new Map<string, Rect>();
    for (const id of gesture.ids) {
      const obj = current.find((entry) => entry.id === id);
      if (obj) {
        rects.set(id, objectBounds(obj));
      }
    }
    gesture.startRects = rects;
    gesture.startBox = unionRects([...rects.values()]);
    const typeOf = typeLookup(current);
    gesture.aspectLocked = gesture.kind === 'resize' && selectionIsAspectLocked(rects.keys(), typeOf);
    inputs.current.options.onGestureStart?.();
    setActiveIds(new Set(rects.keys()));
    // `sel.stacking`: the whole selection goes above everything it can overlap,
    // keeping its own internal order (TC-06, and story 2's single-note drag).
    bringObjectsToFront(inputs.current.doc, [...rects.keys()]);
  };

  /**
   * Apply the newest pointer offset to the document - once per frame.
   *
   * `final` marks the release write: by then the gesture object has been retired,
   * so the guard against a stale queued frame is skipped. Without it a release
   * between two frames would drop the last offset and the object would stop short
   * of the pointer.
   */
  const applyGesture = (gesture: ActiveGesture, final = false): void => {
    gesture.frame = null;
    const pending = gesture.pending;
    const startRects = gesture.startRects;
    if (!pending || !startRects) {
      return;
    }
    if (!final && gesture !== gestureRef.current) {
      return; // a queued frame from a gesture that has already ended
    }
    gesture.pending = null;

    const { doc: document, camera: view, snapshot: current } = inputs.current;
    const zoom = view.zoom || 1;
    const delta = { x: pending.x / zoom, y: pending.y / zoom };

    if (gesture.kind === 'move') {
      const positions = new Map<string, Point>();
      startRects.forEach((rect, id) => {
        positions.set(id, { x: rect.x + delta.x, y: rect.y + delta.y });
      });
      // Ids deleted elsewhere mid-gesture are skipped, not resurrected (TC-05).
      moveObjects(document, positions);
      return;
    }

    const handle = gesture.handle;
    const box = gesture.startBox;
    if (!handle || !box || box.width <= 0 || box.height <= 0) {
      return;
    }

    // `sel.resize` from the bounding box, then `sel.size_limits` on the scale
    // the whole selection may use, then `sel.group_resize` for each object.
    const locked = gesture.aspectLocked || gesture.shiftKey;
    const target = resizeRect(box, handle, delta, locked);
    const requested = {
      x: box.width > 0 ? target.width / box.width : 1,
      y: box.height > 0 ? target.height / box.height : 1,
    };
    const ids = [...startRects.keys()];
    const rects = ids.map((id) => startRects.get(id)!);
    const minSizes = selectionMinSizes(ids, typeLookup(current));
    const scale = clampScale(requested, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = resizeRectFromScale(box, handle, scale);

    const next = new Map<string, Rect>();
    startRects.forEach((rect, id) => {
      next.set(id, scaleWithin(rect, box, to));
    });
    resizeObjects(document, next);
  };

  const scheduleGesture = (gesture: ActiveGesture): void => {
    if (gesture.frame !== null) {
      return; // one write per animation frame (story 2's rule, kept)
    }
    if (typeof requestAnimationFrame === 'function') {
      gesture.frame = requestAnimationFrame(() => applyGesture(gesture));
    } else {
      applyGesture(gesture);
    }
  };

  const beginGesture = (
    event: PointerEventLike,
    kind: GestureKind,
    ids: string[],
    handle: Handle | null,
  ): void => {
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      handle,
      ids,
      startRects: null,
      startBox: null,
      aspectLocked: false,
      moved: false,
      shiftKey: event.shiftKey,
      pending: null,
      frame: null,
    };
    // No pointer capture: the listeners below sit on the window, so the gesture
    // keeps every move and the release even when the pointer leaves the object -
    // and nothing is captured on an element a stacking change may re-mount.
  };

  // --- window-level pointer handling -----------------------------------------
  // One press, one gesture: moves and releases are read from the window, which
  // is what lets a group move start from any object in the selection and keep
  // going when the pointer leaves it.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return; // still a possible click (TC-19)
        }
        gesture.moved = true;
        startGesture(gesture);
      }
      gesture.shiftKey = event.shiftKey;
      gesture.pending = { x: dx, y: dy };
      scheduleGesture(gesture);
    };

    const finish = (event: PointerEvent, cancelled: boolean): void => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      gestureRef.current = null;
      cancelFrame(gesture);
      if (gesture.moved) {
        if (!cancelled) {
          // The release carries the pointer's final position, which is what the
          // write is measured from: browsers are free to coalesce the last
          // move events, and an object must still land under the pointer
          // (story 2's TC-19/TC-20 release).
          const dx = event.clientX - gesture.startX;
          const dy = event.clientY - gesture.startY;
          if (Number.isFinite(dx) && Number.isFinite(dy)) {
            gesture.pending = { x: dx, y: dy };
          }
          if (gesture.pending) {
            applyGesture(gesture, true);
          }
        }
        inputs.current.options.onGestureEnd?.();
      }
      setActiveIds(NO_IDS);
    };

    const onPointerUp = (event: PointerEvent) => finish(event, false);
    const onPointerCancel = (event: PointerEvent) => {
      // A cancelled gesture keeps the last applied write and drops the rest.
      const gesture = gestureRef.current;
      if (gesture && gesture.pointerId === event.pointerId) {
        gesture.pending = null;
      }
      finish(event, true);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      const gesture = gestureRef.current;
      if (gesture) {
        cancelFrame(gesture);
        gestureRef.current = null;
      }
      setActiveIds(NO_IDS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onObjectPointerDown = useCallback((event: PointerEventLike, id: string): void => {
    if (!id || event.button !== 0) {
      return;
    }
    const { selection: sel } = inputs.current;
    if (event.shiftKey) {
      // Shift-click on an object toggles it (`sel.interaction`); Shift+drag on
      // empty space is the marquee, and that is the viewport's business.
      sel.toggle(id);
      return;
    }
    if (!sel.ids.has(id)) {
      // Dragging an unselected object selects only it (TC-23).
      sel.click(id);
    }
    if (!inputs.current.canEdit) {
      return; // TC-25: a board that could not be loaded is not transformed
    }
    const ids = sel.ids.has(id) ? [...sel.ids] : [id];
    beginGesture(event, 'move', ids, null);
  }, []);

  const onHandlePointerDown = useCallback((event: PointerEventLike, handle: Handle): void => {
    if (event.button !== 0) {
      return;
    }
    const { selection: sel, snapshot: current, canEdit } = inputs.current;
    const ids = [...sel.ids];
    if (ids.length === 0 || !canEdit) {
      return;
    }
    const typeOf = typeLookup(current);
    if (!selectionIsResizable(ids, typeOf)) {
      return; // handles are hidden for this selection anyway
    }
    beginGesture(event, 'resize', ids, handle);
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, activeIds };
}

/** Is at least one selected object of a type that can be resized? */
export function selectionHasResizableType(ids: Iterable<string>, snapshot: readonly ObjectSnapshot[]): boolean {
  return selectionIsResizable(ids, typeLookup(snapshot));
}

/** The type spec behind an id, or `undefined` for an id that is not on the board. */
export function specForObject(snapshot: readonly ObjectSnapshot[], id: string) {
  const obj = snapshot.find((entry) => entry.id === id);
  return obj ? getObjectType(obj.type) : undefined;
}
