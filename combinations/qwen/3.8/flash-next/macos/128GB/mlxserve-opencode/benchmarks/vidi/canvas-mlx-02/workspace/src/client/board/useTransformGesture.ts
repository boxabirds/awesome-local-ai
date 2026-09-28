// The generic transform gesture (story 7, sel.transform): ONE pointer gesture
// that moves or resizes the whole selection, used by every object type. Object
// components and the selection handles are grab surfaces only: they hand the
// pointer event to `onObjectPointerDown` / `onHandlePointerDown` and keep no
// pointer logic of their own (sel.all_types).
//
// How a gesture runs (design `sel.transform`, key decisions 1-4):
//  * press -> `Pressed`; nothing is written;
//  * a pointermove of DRAG_THRESHOLD_PX or more (SCREEN pixels, so the
//    threshold does not drift with zoom) starts the gesture: the start rects of
//    the selected objects and their bounding box are recorded, `onGestureStart`
//    runs once (story 8 will open its undo transaction there), and a group move
//    raises the selection above everything unselected;
//  * each animation frame writes ABSOLUTE values derived from the start rects
//    (start + total delta, or the scaled rect), never accumulated per-frame
//    deltas: a concurrent remote move of the same object converges to the last
//    writer instead of drifting;
//  * the group resize clamps the bounding-box scale ONCE (no object may cross
//    its type's minimum size or MAX_OBJECT_SIZE_WORLD) and maps every object
//    with `scaleWithin`, so sizes and the gaps between them scale together;
//  * pointerup flushes the pending frame (the release position is exact) and
//    calls `onGestureEnd` once; pointercancel ends the gesture and simply keeps
//    the last applied frame.
//
// Moves are listened for on `window`, so the pointer may leave the object, the
// viewport or even the browser window mid-drag.
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera.ts';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectsSnapshot,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model.ts';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  isFiniteRect,
  type Handle,
  type Rect,
} from '../../shared/geometry.ts';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config.ts';
import { getObjectType } from '../objects/registry.tsx';
import type { useSelection } from './useSelection.ts';

export type { Handle };

interface StartRect {
  /** the object's own start rect (its bounds, explicit size included) */
  rect: Rect;
  /** the minimum side its type allows */
  minSize: number;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  /** screen point where the press began */
  startX: number;
  startY: number;
  /** screen point of the newest pointermove not yet applied */
  pendingX: number;
  pendingY: number;
  started: boolean;
  /** the ids this gesture transforms (fixed when the press begins) */
  ids: string[];
  startRects: Map<string, StartRect> | null;
  startBox: Rect | null;
  handle: Handle | null;
  aspectLocked: boolean;
  frame: number | null;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  /** the live camera: the world delta is the screen delta divided by its zoom */
  camera: Camera;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** called exactly once when a gesture starts transforming (story 8 boundary) */
  onGestureStart?(): void;
  /** called exactly once when it ends (pointerup or pointercancel) */
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: { clientX: number; clientY: number; pointerId: number; shiftKey: boolean }, id: string): void;
  onHandlePointerDown(e: { clientX: number; clientY: number; pointerId: number; shiftKey: boolean }, handle: Handle): void;
}

// requestAnimationFrame when available; a short timer keeps the same
// "at most one write per frame" behaviour in environments without it.
function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => cb());
  return setTimeout(cb, 16) as unknown as number;
}
function cancelFrame(handle: number | null): void {
  if (handle === null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const gesture = useRef<Gesture | null>(null);
  const attachRef = useRef<() => void>(() => {});

  // Apply the pending frame: absolute values from the gesture's start rects.
  // A refused frame simply leaves the last write in place.
  const applyFrameImpl = (g: Gesture) => {
    g.frame = null;
    const { doc, camera } = optsRef.current;
    const zoom = camera.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    if (!g.started) return;
    if (g.startRects === null || g.startRects.size === 0) return;
    const dx = (g.pendingX - g.startX) / zoom;
    const dy = (g.pendingY - g.startY) / zoom;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    if (g.kind === 'move') {
      if (dx === 0 && dy === 0) return;
      const positions = new Map<string, Point>();
      for (const [id, start] of g.startRects) positions.set(id, { x: start.rect.x + dx, y: start.rect.y + dy });
      moveObjects(doc, positions);
      return;
    }

    if (g.handle === null || g.startBox === null || !isFiniteRect(g.startBox)) return;
    const from = g.startBox;
    const target = resizeRect(from, g.handle, { x: dx, y: dy }, g.aspectLocked);
    if (!isFiniteRect(target)) return;
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    const ids: string[] = [];
    for (const id of g.ids) {
      const start = g.startRects.get(id);
      if (!start) continue;
      rects.push(start.rect);
      minSizes.push(start.minSize);
      ids.push(id);
    }
    if (rects.length === 0) return;
    const scale = clampScale(
      { x: target.width / from.width, y: target.height / from.height },
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return;
    // The box the selection is resized INTO, anchored at the corner/edge the
    // handle is not on (an aspect-locked request stays uniform).
    const width = from.width * scale.x;
    const height = from.height * scale.y;
    const to: Rect = {
      x: g.handle.includes('w') ? from.x + from.width - width : from.x,
      y: g.handle.includes('n') ? from.y + from.height - height : from.y,
      width,
      height,
    };
    if (!isFiniteRect(to)) return;
    const next = new Map<string, Rect>();
    for (const id of ids) {
      const start = g.startRects.get(id)!;
      next.set(id, scaleWithin(start.rect, from, to));
    }
    resizeObjects(doc, next);
  };

  const recordStart = (g: Gesture) => {
    const { doc } = optsRef.current;
    const wanted = new Set(g.ids);
    const rects = new Map<string, StartRect>();
    for (const obj of objectsSnapshot(doc)) {
      if (!wanted.has(obj.id)) continue;
      const spec = getObjectType(obj.type);
      rects.set(obj.id, { rect: objectBounds(obj), minSize: spec ? spec.minSize : 0 });
    }
    g.startRects = rects;
    g.ids = [...rects.keys()]; // ids that vanished between press and start drop out
    g.startBox = unionRects([...rects.values()].map((r) => r.rect));
    g.started = true;
    optsRef.current.onGestureStart?.();
    if (g.kind === 'move' && g.ids.length > 0) {
      // Dragging raises the selection above everything unselected, keeping the
      // relative order inside it (design key decision 4).
      bringObjectsToFront(optsRef.current.doc, g.ids);
    }
  };

  const begin = (
    e: { clientX: number; clientY: number; pointerId: number; shiftKey: boolean },
    kind: 'move' | 'resize',
    handle: Handle | null,
    ids: string[],
    aspectLocked: boolean,
  ) => {
    if (gesture.current !== null) return; // one gesture at a time
    gesture.current = {
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      pendingX: e.clientX,
      pendingY: e.clientY,
      started: false,
      ids,
      startRects: null,
      startBox: null,
      handle,
      aspectLocked,
      frame: null,
    };
    attachRef.current();
  };

  // The frame writer and the window listeners. The listeners exist only while
  // a gesture is alive (a window pointermove listener count probe sees them go
  // up on press and back down on release) and they read the doc and the camera
  // through a ref, so a zoom change during a pinch-drag cannot go stale.
  const write = useRef<(g: Gesture) => void>(() => {});
  const detachRef = useRef<() => void>(() => {});

  write.current = applyFrameImpl;

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      g.pendingX = e.clientX;
      g.pendingY = e.clientY;
      if (!g.started) {
        // Below the threshold the press is still a select, not a drag.
        if (Math.hypot(g.pendingX - g.startX, g.pendingY - g.startY) < DRAG_THRESHOLD_PX) return;
        recordStart(g);
      }
      if (g.frame === null) g.frame = scheduleFrame(() => write.current(g));
    };
    const onPointerUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      gesture.current = null;
      detach();
      if (g.started) {
        cancelFrame(g.frame);
        write.current(g);
        // A press that never crossed the threshold was a select, never a
        // gesture: it announces neither a start nor an end.
        optsRef.current.onGestureEnd?.();
      }
    };
    const onPointerCancel = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      gesture.current = null;
      detach();
      // An interrupted gesture is NOT rolled back: the position it had reached
      // is what stays (story 2's pointercancel case). The pending frame is
      // applied rather than dropped, so the note freezes where the pointer was
      // last seen and nothing is written after this.
      cancelFrame(g.frame);
      if (g.started) {
        write.current(g);
        optsRef.current.onGestureEnd?.();
      }
    };
    const attach = () => {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      detachRef.current = detach;
    };
    function detach() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    }
    attachRef.current = attach;
    return () => {
      const g = gesture.current;
      if (g) cancelFrame(g.frame);
      gesture.current = null;
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onObjectPointerDown: TransformGesture['onObjectPointerDown'] = (e, id) => {
    const o = optsRef.current;
    if (!o.canEdit) return; // a read-only board starts no gesture at all (TC-25)
    if (e.shiftKey) {
      o.selection.toggle(id); // Shift-click adds or removes; it does not drag
      return;
    }
    const ids = o.selection.ids.has(id) ? [...o.selection.ids] : [id];
    if (!o.selection.ids.has(id)) {
      // Dragging an unselected object selects it first (sel.drag_unselected).
      o.selection.click(id);
    }
    begin(e, 'move', null, ids, false);
  };

  const onHandlePointerDown: TransformGesture['onHandlePointerDown'] = (e, handle) => {
    const o = optsRef.current;
    if (!o.canEdit) return;
    const ids = [...o.selection.ids];
    if (ids.length === 0) return;
    let anyResizable = false;
    let aspect = e.shiftKey; // Shift constrains a free type to the box ratio
    const wanted = new Set(ids);
    for (const obj of o.snapshot) {
      if (!wanted.has(obj.id)) continue;
      const spec = getObjectType(obj.type);
      if (!spec || !spec.resizable) continue;
      anyResizable = true;
      if (spec.aspectLocked) aspect = true; // a locked type is always locked
    }
    if (!anyResizable) return; // no selected type can be resized (TC-24 boundary)
    begin(e, 'resize', handle, ids, aspect);
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
