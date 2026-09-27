// Story 7: the shared transform gesture (anchor: sel.transform).
//
// One code path moves and resizes a whole selection for every object type
// (sel.all_types). Objects delegate their pointerdown here; the SelectionOverlay
// handles delegate the resize. The gesture:
//   - crosses a DRAG_THRESHOLD_PX (screen) before it writes anything (a plain
//     click only changes the selection);
//   - captures the start rects at threshold crossing and writes ABSOLUTE rects
//     every frame (Key decision 1), so the frame is correct even if a remote
//     edit moved an object mid-gesture;
//   - raises the selection to the front once, at move start;
//   - throttles doc writes with requestAnimationFrame;
//   - calls onGestureStart / onGestureEnd exactly once per (moved) gesture.
//
// Move: new position = start position + (screen delta / zoom).
// Resize: the group bounding box is resized via `resizeRect` (aspect-locked when
// any selected type is aspect-locked or Shift is held), clamped per-object via
// `clampScale` (Key decision 2), and each object is placed by `scaleWithin`.

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  clampScale,
  placeBox,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Camera } from '../canvas/camera';
import type { SelectionApi } from './useSelection';

type GestureKind = 'move' | 'resize';

interface Gesture {
  kind: GestureKind;
  pointerId: number;
  startScreen: Point;
  dragIds: string[];
  moved: boolean;
  pending: { positions?: ReadonlyMap<string, Point>; rects?: ReadonlyMap<string, Rect> } | null;
  frame: number | null;
  // move
  startPositions?: ReadonlyMap<string, Point>;
  // resize
  handle?: Handle;
  startBox?: Rect;
  startRects?: ReadonlyMap<string, Rect>;
  minSizes?: number[];
  aspectLocked?: boolean;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown: (e: ReactPointerEvent, id: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent, handle: Handle) => void;
}

// --- pure start-capture / resize helpers (no React) ------------------------

function captureMoveStart(g: Gesture, snapshot: readonly ObjectSnapshot[]): void {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const positions = new Map<string, Point>();
  for (const id of g.dragIds) {
    const o = byId.get(id);
    if (o !== undefined) positions.set(id, { x: o.x, y: o.y });
  }
  g.startPositions = positions;
}

function captureResizeStart(g: Gesture, snapshot: readonly ObjectSnapshot[]): void {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const rects = new Map<string, Rect>();
  const minSizes: number[] = [];
  const ids: string[] = [];
  let anyAspect = false;
  for (const id of g.dragIds) {
    const o = byId.get(id);
    if (o === undefined) continue;
    rects.set(id, objectBounds(o));
    const spec = getObjectType(o.type);
    minSizes.push(spec?.minSize ?? STICKY_MIN_SIZE_WORLD);
    if (spec?.aspectLocked === true) anyAspect = true;
    ids.push(id);
  }
  g.dragIds = ids;
  g.startRects = rects;
  g.minSizes = minSizes;
  g.aspectLocked = anyAspect;
  const box = unionRects([...rects.values()]);
  if (box !== null) g.startBox = box;
}

function computeResize(g: Gesture, delta: Point, aspectLocked: boolean): Map<string, Rect> {
  const startBox = g.startBox;
  const startRects = g.startRects;
  const handle = g.handle;
  if (startBox === undefined || startRects === undefined || handle === undefined) {
    return new Map();
  }
  const minSizes = g.minSizes ?? [];
  const newBox = resizeRect(startBox, handle, delta, aspectLocked);
  const rawScale = { x: newBox.width / startBox.width, y: newBox.height / startBox.height };
  const scale = clampScale(rawScale, [...startRects.values()], minSizes, MAX_OBJECT_SIZE_WORLD);
  const targetBox = placeBox(startBox, handle, startBox.width * scale.x, startBox.height * scale.y);
  const rects = new Map<string, Rect>();
  for (const [id, child] of startRects) {
    rects.set(id, scaleWithin(child, startBox, targetBox));
  }
  return rects;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gestureRef = useRef<Gesture | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const endGestureRef = useRef<() => void>(() => {});

  const onWindowMove = useCallback((ev: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null || ev.pointerId !== g.pointerId) return;
    const { camera } = optsRef.current;
    const dx = ev.clientX - g.startScreen.x;
    const dy = ev.clientY - g.startScreen.y;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const snap = optsRef.current.snapshot;
      if (g.kind === 'move') captureMoveStart(g, snap);
      else captureResizeStart(g, snap);
      optsRef.current.onGestureStart?.();
    }
    const deltaWorld: Point = { x: dx / camera.zoom, y: dy / camera.zoom };
    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, p] of g.startPositions ?? []) {
        positions.set(id, { x: p.x + deltaWorld.x, y: p.y + deltaWorld.y });
      }
      g.pending = { positions };
    } else {
      const aspectLocked = (g.aspectLocked ?? false) || ev.shiftKey;
      g.pending = { rects: computeResize(g, deltaWorld, aspectLocked) };
    }
    if (g.frame === null) g.frame = requestAnimationFrame(flushRef.current);
  }, []);

  const onWindowUp = useCallback((ev: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null || ev.pointerId !== g.pointerId) return;
    endGestureRef.current();
  }, []);

  const onWindowCancel = useCallback((ev: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null || ev.pointerId !== g.pointerId) return;
    endGestureRef.current();
  }, []);

  const endGesture = useCallback((): void => {
    const g = gestureRef.current;
    if (g === null) return;
    if (g.frame !== null) {
      cancelAnimationFrame(g.frame);
      g.frame = null;
    }
    const pending = g.pending;
    g.pending = null;
    gestureRef.current = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowCancel);
    if (pending !== null) {
      const { doc } = optsRef.current;
      if (pending.positions !== undefined) moveObjects(doc, pending.positions);
      else if (pending.rects !== undefined) resizeObjects(doc, pending.rects);
    }
    if (g.moved) optsRef.current.onGestureEnd?.();
  }, [onWindowMove, onWindowUp, onWindowCancel]);

  const flushPending = useCallback((): void => {
    const g = gestureRef.current;
    if (g === null) return;
    g.frame = null;
    const pending = g.pending;
    g.pending = null;
    if (pending === null) return;
    const { doc } = optsRef.current;
    if (pending.positions !== undefined) {
      if (moveObjects(doc, pending.positions) === 0) endGesture();
    } else if (pending.rects !== undefined) {
      if (resizeObjects(doc, pending.rects) === 0) endGesture();
    }
  }, [endGesture]);

  flushRef.current = flushPending;
  endGestureRef.current = endGesture;

  const startGesture = useCallback(
    (kind: GestureKind, handle: Handle | undefined, e: ReactPointerEvent, dragIds: string[]): void => {
      if (gestureRef.current !== null) return;
      gestureRef.current = {
        kind,
        handle,
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        dragIds,
        moved: false,
        pending: null,
        frame: null,
      };
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowCancel);
    },
    [onWindowMove, onWindowUp, onWindowCancel],
  );

  // Remove any live listeners if the board unmounts mid-gesture.
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowCancel);
    },
    [onWindowMove, onWindowUp, onWindowCancel],
  );

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent, id: string): void => {
      const { canEdit, selection } = optsRef.current;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gestureRef.current !== null) return;
      // Selection is always available (read-only boards keep selection); only
      // the transform (drag) is gated on canEdit.
      if (e.shiftKey) {
        selection.toggle(id);
        return;
      }
      if (selection.ids.has(id)) {
        if (canEdit) startGesture('move', undefined, e, [...selection.ids]);
      } else {
        selection.click(id);
        if (canEdit) startGesture('move', undefined, e, [id]);
      }
    },
    [startGesture],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: Handle): void => {
      const { canEdit, selection, snapshot } = optsRef.current;
      if (!canEdit) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gestureRef.current !== null) return;
      const selected = [...selection.ids];
      if (selected.length === 0) return;
      const byId = new Map(snapshot.map((o) => [o.id, o]));
      const anyResizable = selected.some((id) => {
        const o = byId.get(id);
        return o !== undefined && getObjectType(o.type)?.resizable === true;
      });
      if (!anyResizable) return;
      startGesture('resize', handle, e, selected);
    },
    [startGesture],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
