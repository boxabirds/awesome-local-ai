// Shared pointer gesture for moving and resizing the current selection
// (see spec: sel.drag, sel.resize).
//
// One hook serves both entry points: pointer-down on an object (move) and
// pointer-down on a selection-overlay handle (resize).
//
// Key decisions (design doc, "Key technical decisions"):
// - writes are ABSOLUTE positions/sizes computed from the snapshot at gesture
//   start, not deltas, so concurrent edits from other clients are never
//   double-applied;
// - pointer capture keeps the gesture alive even when the pointer outruns
//   the object;
// - rAF-throttled doc writes (one per frame), final flush on release;
// - a pointer-cancel keeps the last applied state (interrupted, not reverted);
// - the drag starts after a 3px threshold, so a plain click only selects.
//
// Move: every selected object goes to its start position + the world delta;
// on activation the group is brought to front.
// Resize: the union box is resized by the handle (aspect-locked when any
// selected type locks its ratio or Shift is held), the scale is clamped to
// every object's min/max size, and each object is re-expressed inside the
// clamped box (scaleWithin).

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { clampScale, resizeRect, scaleWithin, unionRects, type Handle, type Point, type Rect } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { useSelection } from './useSelection';

export type SelectionApi = ReturnType<typeof useSelection>;

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  /** The current client may edit the board (false while load_failed). */
  canEdit: boolean;
  /** A real gesture (past the threshold) started. */
  onGestureStart?(): void;
  /** A started gesture ended (released, cancelled, or interrupted). */
  onGestureEnd?(): void;
}

interface Gesture {
  pointerId: number;
  kind: 'move' | 'resize';
  startClient: Point;
  phase: 'pressed' | 'active';
  ids: string[];
  startRects: Map<string, Rect> | null;
  startBox: Rect | null;
  handle: Handle | null;
  pending: Map<string, Rect> | null;
  raf: number | null;
}

export interface TransformGesture {
  /** Pointer-down on an object: select + start a move gesture. */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Pointer-down on a selection-overlay handle: start a resize gesture. */
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  /** Ids of objects currently moving (drives data-dragging). */
  draggingIds: ReadonlySet<string>;
}

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(options);
  optsRef.current = options;

  const gestureRef = useRef<Gesture | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set());

  /** Write the pending absolute state (move or resize). */
  const applyPending = useCallback((g: Gesture) => {
    if (g.raf !== null) {
      cancelAnimationFrame(g.raf);
      g.raf = null;
    }
    if (g.pending === null || g.pending.size === 0) return;
    const { doc } = optsRef.current;
    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, r] of g.pending) positions.set(id, { x: r.x, y: r.y });
      moveObjects(doc, positions);
    } else {
      resizeObjects(doc, g.pending);
    }
    g.pending = null;
  }, []);

  const scheduleApply = useCallback(() => {
    const g = gestureRef.current;
    if (g === null || g.raf !== null) return;
    g.raf = requestAnimationFrame(() => {
      const current = gestureRef.current;
      if (current === null || current.raf === null) return;
      applyPending(current);
    });
  }, [applyPending]);

  // Native listeners, created once: they only read refs, so the first
  // render's closures stay valid for the component's whole life.
  const handlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  if (handlersRef.current === null) {
    const onMove = (event: PointerEvent) => {
      const g = gestureRef.current;
      if (g === null || event.pointerId !== g.pointerId) return;
      const { camera, snapshot, onGestureStart } = optsRef.current;
      const dx = event.clientX - g.startClient.x;
      const dy = event.clientY - g.startClient.y;

      if (g.phase === 'pressed') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        const byId = new Map(snapshot.map((o) => [o.id, o]));
        const startRects = new Map<string, Rect>();
        for (const id of g.ids) {
          const obj = byId.get(id);
          if (obj === undefined) continue; // deleted between press and drag
          startRects.set(id, objectBounds(obj));
        }
        if (startRects.size === 0) {
          gestureRef.current = null;
          detachHandlers(handlersRef.current!);
          return;
        }
        g.phase = 'active';
        g.startRects = startRects;
        g.startBox = unionRects([...startRects.values()]);
        if (g.kind === 'move') {
          bringObjectsToFront(optsRef.current.doc, [...startRects.keys()]);
          onGestureStart?.();
          setDraggingIds(new Set(startRects.keys()));
        } else {
          onGestureStart?.();
        }
      }

      if (g.phase !== 'active' || g.startRects === null || g.startBox === null) return;
      const zoom = camera.zoom;
      const delta: Point = { x: dx / zoom, y: dy / zoom };

      if (g.kind === 'move') {
        const pending = new Map<string, Rect>();
        for (const [id, r] of g.startRects) {
          pending.set(id, { x: r.x + delta.x, y: r.y + delta.y, width: r.width, height: r.height });
        }
        g.pending = pending;
      } else {
        if (g.handle === null) return;
        const byId = new Map(snapshot.map((o) => [o.id, o]));
        let aspectLocked = event.shiftKey;
        for (const id of g.ids) {
          const obj = byId.get(id);
          if (obj !== undefined && getObjectType(obj.type)?.aspectLocked) {
            aspectLocked = true;
            break;
          }
        }
        const target = resizeRect(g.startBox, g.handle, delta, aspectLocked);
        const startRectList = [...g.startRects.values()];
        const minSizes = [...g.startRects.keys()].map((id) => {
          const obj = byId.get(id);
          return (obj !== undefined ? getObjectType(obj.type)?.minSize : undefined) ?? 0;
        });
        const scale: Point = {
          x: g.startBox!.width > 0 ? target.width / g.startBox!.width : 1,
          y: g.startBox!.height > 0 ? target.height / g.startBox!.height : 1,
        };
        const clamped = clampScale(scale, startRectList, minSizes, MAX_OBJECT_SIZE_WORLD);
        // Aspect-locked selections must stay uniform: both axes share the
        // more restrictive clamped scale.
        const sx = aspectLocked ? Math.min(clamped.x, clamped.y) : clamped.x;
        const sy = aspectLocked ? Math.min(clamped.x, clamped.y) : clamped.y;
        const clampedBox: Rect = {
          x: g.startBox!.x,
          y: g.startBox!.y,
          width: g.startBox!.width * sx,
          height: g.startBox!.height * sy,
        };
        const pending = new Map<string, Rect>();
        for (const [id, r] of g.startRects) {
          pending.set(id, scaleWithin(r, g.startBox!, clampedBox));
        }
        g.pending = pending;
      }
      scheduleApply();
    };

    const finish = (event: PointerEvent, flush: boolean) => {
      const g = gestureRef.current;
      if (g === null || event.pointerId !== g.pointerId) return;
      detachHandlers(handlersRef.current!);
      if (g.phase === 'active') {
        if (flush) applyPending(g);
        else if (g.raf !== null) {
          cancelAnimationFrame(g.raf);
          g.raf = null;
        }
        optsRef.current.onGestureEnd?.();
        setDraggingIds(new Set());
      }
      gestureRef.current = null;
    };

    handlersRef.current = {
      move: onMove,
      up: (event) => finish(event, true),
      cancel: (event) => finish(event, false),
    };
  }

  const attachHandlers = useCallback(() => {
    const handlers = handlersRef.current!;
    window.addEventListener('pointermove', handlers.move);
    window.addEventListener('pointerup', handlers.up);
    window.addEventListener('pointercancel', handlers.cancel);
  }, []);

  // One active gesture at a time.
  const beginGesture = useCallback(
    (e: ReactPointerEvent<HTMLElement>, kind: Gesture['kind'], ids: string[], handle: Handle | null) => {
      if (e.button !== 0 || gestureRef.current !== null) return;
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      void doc;
      if (!canEdit || ids.length === 0) return;
      // Resize handles only make sense on a selection with resizable objects.
      if (kind === 'resize') {
        const selected = snapshot.filter((o) => selection.ids.has(o.id));
        if (selected.length === 0 || !selected.some((o) => getObjectType(o.type)?.resizable)) return;
      }
      gestureRef.current = {
        pointerId: e.pointerId,
        kind,
        startClient: { x: e.clientX, y: e.clientY },
        phase: 'pressed',
        ids,
        startRects: null,
        startBox: null,
        handle,
        pending: null,
        raf: null,
      };
      try {
        e.currentTarget?.setPointerCapture(e.pointerId);
      } catch {
        // jsdom has no pointer capture; the gesture still works.
      }
      attachHandlers();
    },
    [attachHandlers],
  );

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string) => {
      e.stopPropagation(); // the board must not pan when a drag starts on an object
      const { selection, canEdit } = optsRef.current;
      let ids: string[];
      if (selection.ids.has(id)) {
        ids = [...selection.ids];
      } else {
        selection.click(id);
        ids = [id];
      }
      beginGesture(e, 'move', canEdit ? ids : [], null);
    },
    [beginGesture],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle) => {
      e.stopPropagation();
      const { selection } = optsRef.current;
      beginGesture(e, 'resize', [...selection.ids], handle);
    },
    [beginGesture],
  );

  // Clean up an in-flight gesture if the board unmounts.
  useEffect(() => {
    const handlers = handlersRef.current;
    const gesture = gestureRef.current;
    return () => {
      if (gesture !== null && gesture.raf !== null) cancelAnimationFrame(gesture.raf);
      if (handlers !== null) detachHandlers(handlers);
      gestureRef.current = null;
    };
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}

function detachHandlers(handlers: {
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
}) {
  window.removeEventListener('pointermove', handlers.move);
  window.removeEventListener('pointerup', handlers.up);
  window.removeEventListener('pointercancel', handlers.cancel);
}
