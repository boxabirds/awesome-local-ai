import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  applyResizeScale,
  clampScale,
  resizeScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  /** False while the board cannot be changed: the gesture selects, never writes. */
  canEdit: boolean;
  /**
   * Called once per gesture, at the moment a press becomes a drag (not for a
   * plain click). Story 8 opens an undo group here.
   */
  onGestureStart?(): void;
  /** Called once when a started gesture ends — including a cancelled one. */
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** Press on an object's body: select it, then move the selection. */
  onObjectPointerDown(
    event: ReactPointerEvent | PointerEvent,
    snapshot: ObjectSnapshot,
  ): void;
  /** Press on one of the selection's resize handles. */
  onHandlePointerDown(event: ReactPointerEvent | PointerEvent, handle: Handle): void;
  /** The objects a gesture is moving right now (toolbar hides, `data-dragging`). */
  readonly draggingIds: ReadonlySet<string>;
}

interface GestureBase {
  pointerId: number;
  /** Press position in screen pixels, and the zoom that applied then. */
  startX: number;
  startY: number;
  zoom: number;
  /** Past the drag threshold, so the press became a transform. */
  moved: boolean;
  /** `onGestureStart` has been called, so `onGestureEnd` owes a call too. */
  announced: boolean;
}

interface MoveGesture extends GestureBase {
  mode: 'move';
  /** The object that was pressed. */
  id: string;
  /** Shift+press: toggles the selection on release and never moves anything. */
  toggles: boolean;
  /** The board could be changed when the press started. */
  writable: boolean;
  /** What the gesture moves: the selection, or just the pressed object. */
  ids: string[];
  /** Where each of them was when the drag began (absolute writes, key decision 1). */
  start: Map<string, Point>;
}

interface ResizeGesture extends GestureBase {
  mode: 'resize';
  handle: Handle;
  /** The selection's bounding box at gesture start. */
  box: Rect;
  items: { id: string; rect: Rect; minSize: number }[];
  /** True when any selected type keeps its proportions. */
  aspectLocked: boolean;
}

type Gesture = MoveGesture | ResizeGesture;

/**
 * The one gesture that moves and resizes board objects.
 *
 * A press on an object is a click, or — past DRAG_THRESHOLD_PX — a group move
 * of the whole selection; a press on a handle is a resize of the selection's
 * bounding box, applied to every object inside it. The note itself contains
 * none of this: any type registered in the registry behaves identically
 * (`sel.all_types`).
 *
 * Every frame writes *absolute* positions derived from where the objects were
 * when the drag started, so a concurrent remote move of the same object converges
 * to one shared result instead of accumulating drift. Writes are throttled to one
 * per animation frame and flushed on release, so the last position the user saw
 * is the position that is stored.
 */
export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = options;

  // The handlers are installed on `window` once, so they must read the current
  // values from a ref rather than close over the render they were created in.
  const live = useRef({ doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd });
  live.current = { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd };

  const gestureRef = useRef<Gesture | null>(null);
  const writeRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(() => new Set());

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  /** Apply the queued write now (release, cancel, unmount). */
  const flush = useCallback(() => {
    cancelFrame();
    const write = writeRef.current;
    writeRef.current = null;
    write?.();
  }, [cancelFrame]);

  /** Queue a write for the next frame; only the newest position survives. */
  const schedule = useCallback(
    (write: () => void) => {
      writeRef.current = write;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = writeRef.current;
        writeRef.current = null;
        pending?.();
      });
    },
    [],
  );

  const finish = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.announced) live.current.onGestureEnd?.();
    setDraggingIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const startMove = useCallback(
    (gesture: MoveGesture) => {
      const ids = live.current.selection.has(gesture.id)
        ? [...live.current.selection.ids]
        : [gesture.id];
      if (!live.current.selection.has(gesture.id)) {
        // Dragging an unselected object selects just it first (sel.drag_unselected).
        live.current.selection.click(gesture.id);
      }
      const start = new Map<string, Point>();
      for (const object of live.current.snapshot) {
        if (ids.includes(object.id)) {
          const bounds = objectBounds(object);
          start.set(object.id, { x: bounds.x, y: bounds.y });
        }
      }
      gesture.ids = ids;
      gesture.start = start;
      gesture.moved = true;
      gesture.announced = true;
      // The boundary comes first so the raise below belongs to this gesture:
      // one drag is one undo step, and undoing it also puts the note back in the
      // pile it came from.
      live.current.onGestureStart?.();
      // Raised once at the start of the drag, not per frame.
      bringObjectsToFront(live.current.doc, ids);
      setDraggingIds(new Set(ids));
    },
    [],
  );

  const startResize = useCallback((gesture: ResizeGesture, shift: boolean) => {
    gesture.moved = true;
    gesture.announced = true;
    gesture.aspectLocked = gesture.aspectLocked || shift;
    live.current.onGestureStart?.();
    setDraggingIds(new Set(gesture.items.map((item) => item.id)));
  }, []);

  const onMove = useCallback(
    (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;

      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        if (gesture.mode === 'move') {
          if (gesture.toggles || !gesture.writable) return;
          startMove(gesture);
        } else {
          startResize(gesture, event.shiftKey);
        }
      }

      // Board units: screen pixels divided by the zoom captured at press.
      const zoom = gesture.zoom || 1;
      if (gesture.mode === 'move') {
        const positions = new Map<string, Point>();
        for (const [id, at] of gesture.start) {
          positions.set(id, { x: at.x + dx / zoom, y: at.y + dy / zoom });
        }
        schedule(() => moveObjects(live.current.doc, positions));
        return;
      }

      const asked = resizeScale(
        gesture.box,
        gesture.handle,
        { x: dx / zoom, y: dy / zoom },
        gesture.aspectLocked || event.shiftKey,
      );
      const clamped = clampScale(
        asked,
        gesture.items.map((item) => item.rect),
        gesture.items.map((item) => item.minSize),
        MAX_OBJECT_SIZE_WORLD,
      );
      const to = applyResizeScale(gesture.box, gesture.handle, clamped);
      const rects = new Map<string, Rect>();
      for (const item of gesture.items) {
        rects.set(item.id, scaleWithin(item.rect, gesture.box, to));
      }
      schedule(() => resizeObjects(live.current.doc, rects));
    },
    [schedule, startMove, startResize],
  );

  const onUp = useCallback(
    (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      flush();
      if (!gesture.moved && gesture.mode === 'move') {
        // A click, not a drag: this is where the selection lands (story 2: a
        // press alone must not look selected yet).
        if (gesture.toggles) live.current.selection.toggle(gesture.id);
        else live.current.selection.click(gesture.id);
      }
      finish();
    },
    [finish, flush],
  );

  const onCancel = useCallback(
    (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      // Whatever was last shown stays shown (PRD drag.cancel); nothing rewinds.
      flush();
      finish();
    },
    [finish, flush],
  );

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cancelFrame();
      writeRef.current = null;
      gestureRef.current = null;
    };
  }, [onMove, onUp, onCancel, cancelFrame]);

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent | PointerEvent, object: ObjectSnapshot) => {
      if (event.button !== 0) return;
      const { camera: cam, canEdit: editable } = live.current;
      gestureRef.current = {
        mode: 'move',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        zoom: cam.zoom || 1,
        moved: false,
        announced: false,
        id: object.id,
        // Shift is the marquee modifier: on an object it only toggles.
        toggles: event.shiftKey,
        writable: editable,
        ids: [],
        start: new Map(),
      };
      // A press under the threshold has not decided yet: the selection changes on
      // release, so a press never looks selected (story 2 rule, kept on purpose).
    },
    [],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent | PointerEvent, handle: Handle) => {
      if (event.button !== 0) return;
      const { selection: sel, snapshot: objects, canEdit: editable, camera: cam } = live.current;
      if (!editable) return;
      const items: { id: string; rect: Rect; minSize: number }[] = [];
      let aspectLocked = false;
      let resizable = false;
      for (const object of objects) {
        if (!sel.has(object.id)) continue;
        const spec = getObjectType(object.type);
        if (!spec) continue;
        if (spec.resizable) resizable = true;
        if (spec.aspectLocked) aspectLocked = true;
        items.push({ id: object.id, rect: objectBounds(object), minSize: spec.minSize });
      }
      if (!resizable || items.length === 0) return;
      const box = unionRects(items.map((item) => item.rect));
      if (!box) return;
      gestureRef.current = {
        mode: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        zoom: cam.zoom || 1,
        moved: false,
        announced: false,
        handle,
        box,
        items,
        aspectLocked,
      };
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
