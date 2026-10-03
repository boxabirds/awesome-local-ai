import { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '../../shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Rect,
  type Point,
  type Handle,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Camera } from '../canvas/camera';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  /** False (board failed to load) → gestures are ignored, no writes. */
  canEdit: boolean;
  /** Undo-boundary hooks (story 8); each called exactly once per gesture. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface GestureState {
  kind: 'object' | 'handle';
  pointerId: number;
  startScreen: Point;
  /** The object being grabbed (object gestures) — for `data-dragging`. */
  dragId: string | null;
  /** Start bounds of every selected object, captured at threshold crossing. */
  startRects: Map<string, Rect> | null;
  startBox: Rect | null;
  handle: Handle | null;
  aspectLocked: boolean;
  moved: boolean;
  raf: number | null;
  apply: (() => void) | null;
  /** Pending absolute targets: positions for moves, rects for resizes. */
  pendingMove: Map<string, Point> | null;
  pendingRects: Map<string, Rect> | null;
}

/**
 * The generic transform gesture (sel.transform): group move and bounding-box
 * resize, shared by every object type.
 *
 * - `onObjectPointerDown`: Shift+click toggles the object; a plain press
 *   selects it (replacing the selection when unselected, sel.drag_unselected)
 *   and, beyond DRAG_THRESHOLD_PX, moves the whole selection by absolute
 *   writes of `start + delta` (key decision 1) after raising it above all
 *   unselected objects (key decision 4).
 * - `onHandlePointerDown`: resizes the selection's bounding box from the
 *   opposite corner/edge; aspect-locked when any selected type is
 *   `aspectLocked` or Shift is held (key decision 3); the scale is clamped
 *   once against every object's minSize and MAX_OBJECT_SIZE_WORLD (key
 *   decision 2), then applied uniformly with `scaleWithin`.
 *
 * Writes are throttled to one per animation frame; the final target is
 * flushed on pointerup. pointercancel keeps the last applied state.
 * `canEdit === false` → gestures ignored. Objects pruned mid-gesture are
 * skipped by the model.
 */
export function useTransformGesture(opts: TransformGestureOptions): {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  /** The object currently being moved (for `data-dragging`), or null. */
  draggingId: string | null;
} {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gestureRef = useRef<GestureState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const onMove = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const o = optsRef.current;
    const dx = e.clientX - g.startScreen.x;
    const dy = e.clientY - g.startScreen.y;

    if (!g.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const rects = new Map<string, Rect>();
      for (const obj of o.snapshot) {
        if (o.selection.ids.has(obj.id)) rects.set(obj.id, objectBounds(obj));
      }
      if (rects.size === 0) return;
      g.startRects = rects;
      g.startBox = unionRects([...rects.values()]);
      o.onGestureStart?.();
      if (g.kind === 'object') {
        // The dragged object ends on top of the (raised) group.
        bringObjectsToFront(o.doc, [...o.selection.ids], g.dragId ?? undefined);
        setDraggingId(g.dragId);
      }
    }

    const zoom = o.camera.zoom || 1;
    const delta: Point = { x: dx / zoom, y: dy / zoom };

    if (g.kind === 'object' && g.startRects) {
      const pending = new Map<string, Point>();
      for (const [id, r] of g.startRects) {
        pending.set(id, { x: r.x + delta.x, y: r.y + delta.y });
      }
      g.pendingMove = pending;
      g.apply = () => {
        const st = gestureRef.current;
        if (st && st.pendingMove) moveObjects(optsRef.current.doc, st.pendingMove);
      };
    } else if (g.kind === 'handle' && g.startRects && g.startBox && g.handle) {
      const newBox = resizeRect(g.startBox, g.handle, delta, g.aspectLocked);
      const scale: Point = {
        x: g.startBox.width > 0 ? newBox.width / g.startBox.width : 1,
        y: g.startBox.height > 0 ? newBox.height / g.startBox.height : 1,
      };
      const startRectList = [...g.startRects.values()];
      const minSizes = [...g.startRects.keys()].map((id) => {
        const obj = o.snapshot.find((s) => s.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        return spec?.minSize ?? 0;
      });
      const clamped = clampScale(scale, startRectList, minSizes, MAX_OBJECT_SIZE_WORLD);
      const to: Rect = {
        x: g.handle.includes('w')
          ? g.startBox.x + g.startBox.width * (1 - clamped.x)
          : g.startBox.x,
        y: g.handle.includes('n')
          ? g.startBox.y + g.startBox.height * (1 - clamped.y)
          : g.startBox.y,
        width: g.startBox.width * clamped.x,
        height: g.startBox.height * clamped.y,
      };
      const rects = new Map<string, Rect>();
      for (const [id, r] of g.startRects) rects.set(id, scaleWithin(r, g.startBox, to));
      g.pendingRects = rects;
      g.apply = () => {
        const st = gestureRef.current;
        if (st && st.pendingRects) resizeObjects(optsRef.current.doc, st.pendingRects);
      };
    }

    if (g.apply && g.raf === null) {
      g.raf = requestAnimationFrame(() => {
        const st = gestureRef.current;
        if (!st) return;
        st.raf = null;
        st.apply?.();
      });
    }
  }, []);

  const finish = useCallback((cancelled: boolean) => {
    const g = gestureRef.current;
    if (!g) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    gestureRef.current = null;
    if (g.raf !== null) {
      cancelAnimationFrame(g.raf);
      g.raf = null;
    }
    if (g.moved) {
      if (!cancelled) {
        // Flush the final target so the release lands exactly (key decision 1).
        if (g.pendingMove) moveObjects(optsRef.current.doc, g.pendingMove);
        if (g.pendingRects) resizeObjects(optsRef.current.doc, g.pendingRects);
      }
      optsRef.current.onGestureEnd?.();
    }
    setDraggingId(null);
  }, [onMove]);

  const onUp = useCallback(
    (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      finish(false);
    },
    [finish],
  );

  const onCancel = useCallback(
    (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      finish(true); // keep the last applied state
    },
    [finish],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      const o = optsRef.current;
      if (e.shiftKey) {
        // Shift-click adds or removes (sel.shift_toggle); no gesture.
        o.selection.toggle(id);
        return;
      }
      // A plain click selects only this object when it is not already
      // selected (sel.drag_unselected). Selection works even when the board
      // cannot be edited (viewing); the gesture does not.
      if (!o.selection.ids.has(id)) o.selection.click(id);
      if (!o.canEdit) return;

      gestureRef.current = {
        kind: 'object',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        dragId: id,
        startRects: null,
        startBox: null,
        handle: null,
        aspectLocked: false,
        moved: false,
        raf: null,
        apply: null,
        pendingMove: null,
        pendingRects: null,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [onMove, onUp, onCancel],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      const o = optsRef.current;
      if (!o.canEdit) return;
      // Handles are hidden unless a selected type is resizable; refuse here too.
      let anyResizable = false;
      let aspectLocked = false;
      for (const obj of o.snapshot) {
        if (!o.selection.ids.has(obj.id)) continue;
        const spec = getObjectType(obj.type);
        if (!spec) continue;
        if (spec.resizable) anyResizable = true;
        if (spec.aspectLocked) aspectLocked = true;
      }
      if (!anyResizable) return;

      const rects = new Map<string, Rect>();
      for (const obj of o.snapshot) {
        if (o.selection.ids.has(obj.id)) rects.set(obj.id, objectBounds(obj));
      }
      if (rects.size === 0) return;

      gestureRef.current = {
        kind: 'handle',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        dragId: null,
        startRects: rects,
        startBox: unionRects([...rects.values()]),
        handle,
        aspectLocked: aspectLocked || e.shiftKey,
        moved: false,
        raf: null,
        apply: null,
        pendingMove: null,
        pendingRects: null,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [onMove, onUp, onCancel],
  );

  return { onObjectPointerDown, onHandlePointerDown, draggingId };
}
