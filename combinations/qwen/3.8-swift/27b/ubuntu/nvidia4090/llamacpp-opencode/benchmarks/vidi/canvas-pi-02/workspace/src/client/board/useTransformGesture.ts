// Generic transform gesture (story 7, sel.transform): group move and
// bounding-box resize for any registered object type.
//
// Key decisions (design):
//  - ABSOLUTE writes from gesture start: every frame writes
//    `start + total delta`, so concurrent remote moves converge to the last
//    writer (no per-frame deltas accumulating against remote changes).
//  - The gesture owns ONE pointer: pointerdown (object or handle) →
//    pointermove (window) → pointerup (window).
//  - Group resize scales are clamped ONCE for the whole selection
//    (clampScale): the group stops at its first min/max, uniform per axis,
//    so relative layout and sizes are preserved (TC-03).
//  - Writes go through moveObjects/resizeObjects (board-model), one
//    LOCAL_ORIGIN transaction per rAF flush.

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
  clampScale,
  resizeRect,
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

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pressed'; pointerId: number; id: string; startClientX: number; startClientY: number }
  | {
      kind: 'pressedHandle';
      pointerId: number;
      handle: Handle;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'move';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startRects: Map<string, Rect>;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      handle: Handle;
      startBox: Rect;
      startRects: Map<string, Rect>;
      minSizes: number[];
      aspectLocked: boolean;
    };

type Pending = { kind: 'move'; data: Map<string, Point> } | { kind: 'resize'; data: Map<string, Rect> };

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  /** False when the board is locked (load failed): selection only. */
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  onDraggingChange?(dragging: boolean): void;
}

export interface TransformGestureApi {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /** True while a move/resize is in progress (for the dragging style). */
  dragging: boolean;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureApi {
  const { doc } = opts;

  // Live values behind stable window listeners.
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onGestureStartRef = useRef(opts.onGestureStart);
  onGestureStartRef.current = opts.onGestureStart;
  const onGestureEndRef = useRef(opts.onGestureEnd);
  onGestureEndRef.current = opts.onGestureEnd;
  const onDraggingChangeRef = useRef(opts.onDraggingChange);
  onDraggingChangeRef.current = opts.onDraggingChange;

  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const pendingRef = useRef<Pending | null>(null);
  const rafRef = useRef<number | null>(null);
  const wroteRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const setDraggingBoth = (value: boolean): void => {
    setDragging(value);
    onDraggingChangeRef.current?.(value);
  };

  /** Applies the pending write; returns the number of objects changed. */
  const flush = (): number => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null) return 0;
    const applied =
      pending.kind === 'move' ? moveObjects(doc, pending.data) : resizeObjects(doc, pending.data);
    if (applied > 0) wroteRef.current = true;
    return applied;
  };

  const endGesture = useCallback(
    (pointerId: number) => {
      const gesture = gestureRef.current;
      if ((gesture.kind !== 'move' && gesture.kind !== 'resize') || gesture.pointerId !== pointerId) {
        return;
      }
      gestureRef.current = { kind: 'idle' }; // idempotency first
      flush();
      setDraggingBoth(false);
      onGestureEndRef.current?.();
    },
    [doc],
  );

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const applied = flush();
      if (applied === 0) {
        // Every gesture object was deleted remotely: end the gesture.
        const gesture = gestureRef.current;
        if (gesture.kind === 'move' || gesture.kind === 'resize') {
          endGesture(gesture.pointerId);
        }
      }
    });
  }, [doc, endGesture]);

  const beginMove = (gesture: Extract<Gesture, { kind: 'pressed' }>): void => {
    const sel = selectionRef.current;
    const startRects = new Map<string, Rect>();
    for (const o of snapshotRef.current) {
      if (sel.ids.has(o.id)) startRects.set(o.id, objectBounds(o));
    }
    if (startRects.size === 0) {
      gestureRef.current = { kind: 'idle' };
      return;
    }
    // Group stacking on gesture start: the whole selection above all others,
    // relative order preserved (the "bring to front on move" behaviour).
    bringObjectsToFront(doc, [...startRects.keys()]);
    wroteRef.current = false;
    setDraggingBoth(true);
    onGestureStartRef.current?.();
    gestureRef.current = {
      kind: 'move',
      pointerId: gesture.pointerId,
      startClientX: gesture.startClientX,
      startClientY: gesture.startClientY,
      startRects,
    };
  };

  const beginResize = (gesture: Extract<Gesture, { kind: 'pressedHandle' }>): void => {
    const sel = selectionRef.current;
    const snap = snapshotRef.current;
    const selected = snap.filter((o) => sel.ids.has(o.id));
    const startBox = unionRects(selected.map(objectBounds));
    if (startBox === null) {
      gestureRef.current = { kind: 'idle' };
      return;
    }
    const startRects = new Map<string, Rect>();
    const minSizes: number[] = [];
    for (const o of selected) {
      startRects.set(o.id, objectBounds(o));
      minSizes.push(getObjectType(o.type)?.minSize ?? 0);
    }
    const anyAspect = selected.some((o) => getObjectType(o.type)?.aspectLocked === true);
    wroteRef.current = false;
    setDraggingBoth(true);
    onGestureStartRef.current?.();
    gestureRef.current = {
      kind: 'resize',
      pointerId: gesture.pointerId,
      startClientX: gesture.startClientX,
      startClientY: gesture.startClientY,
      handle: gesture.handle,
      startBox,
      startRects,
      minSizes,
      // Shift mid-gesture is read on every move; capture the base lock.
      aspectLocked: anyAspect,
    };
  };

  const handleMove = useCallback(
    (e: PointerEvent) => {
      let gesture = gestureRef.current;
      if (gesture.kind === 'idle' || e.pointerId !== gesture.pointerId) return;
      const dx = e.clientX - gesture.startClientX;
      const dy = e.clientY - gesture.startClientY;

      if (gesture.kind === 'pressed' || gesture.kind === 'pressedHandle') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a click/press
        if (gesture.kind === 'pressed') beginMove(gesture);
        else beginResize(gesture);
        // The transition consumed the start state; re-read and apply THIS
        // move (the threshold-crossing delta is not lost).
        gesture = gestureRef.current;
        if (gesture.kind === 'idle' || gesture.kind === 'pressed' || gesture.kind === 'pressedHandle') {
          return; // only move/resize remain after the transition
        }
      }

      const zoom = cameraRef.current.zoom;
      const delta: Point = { x: dx / zoom, y: dy / zoom };

      if (gesture.kind === 'move') {
        const positions = new Map<string, Point>();
        for (const [id, r] of gesture.startRects) {
          positions.set(id, { x: r.x + delta.x, y: r.y + delta.y });
        }
        pendingRef.current = { kind: 'move', data: positions };
        scheduleFlush();
        return;
      }

      // Resize: requested box, dominant-axis aspect lock, clamped scale,
      // then each object scaled within the box (relative layout preserved).
      const requested = resizeRect(gesture.startBox, gesture.handle, delta, gesture.aspectLocked || e.shiftKey);
      const scale = clampScale(
        {
          x: Number.isFinite(requested.width) ? requested.width / gesture.startBox.width : 1,
          y: Number.isFinite(requested.height) ? requested.height / gesture.startBox.height : 1,
        },
        [...gesture.startRects.values()],
        gesture.minSizes,
        MAX_OBJECT_SIZE_WORLD,
      );
      const to: Rect = {
        x: gesture.handle.includes('w')
          ? gesture.startBox.x + gesture.startBox.width - gesture.startBox.width * scale.x
          : gesture.startBox.x,
        y: gesture.handle.includes('n')
          ? gesture.startBox.y + gesture.startBox.height - gesture.startBox.height * scale.y
          : gesture.startBox.y,
        width: gesture.startBox.width * scale.x,
        height: gesture.startBox.height * scale.y,
      };
      const rects = new Map<string, Rect>();
      for (const [id, r] of gesture.startRects) {
        rects.set(id, scaleWithin(r, gesture.startBox, to));
      }
      pendingRef.current = { kind: 'resize', data: rects };
      scheduleFlush();
    },
    [doc, scheduleFlush],
  );

  const handleUp = useCallback(
    (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture.kind === 'idle' || e.pointerId !== gesture.pointerId) return;
      if (gesture.kind === 'pressed') {
        gestureRef.current = { kind: 'idle' }; // a plain click
        return;
      }
      endGesture(e.pointerId);
    },
    [endGesture],
  );

  useEffect(() => {
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      gestureRef.current = { kind: 'idle' };
    };
  }, [handleMove, handleUp]);

  const onObjectPointerDown = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const sel = selectionRef.current;
    if (e.shiftKey) {
      sel.toggle(id);
      return; // shift+click never starts a gesture
    }
    if (!sel.ids.has(id)) sel.click(id);
    if (!canEditRef.current) return; // locked board: selection only
    gestureRef.current = {
      kind: 'pressed',
      pointerId: e.pointerId,
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
  }, []);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent, handle: Handle) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    if (!canEditRef.current) return;
    const sel = selectionRef.current;
    if (sel.ids.size === 0) return;
    gestureRef.current = {
      kind: 'pressedHandle',
      pointerId: e.pointerId,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, dragging };
}
