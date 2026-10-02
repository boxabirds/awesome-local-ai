import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
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
import { getObjectType } from '../objects/registry';

/**
 * Story 7: the generic transform gesture. One code path handles both
 * group-move (pointer down on a selected object) and bounding-box resize
 * (pointer down on a resize handle). Screen deltas are divided by the camera
 * zoom so the grabbed point stays under the pointer at any zoom.
 *
 * - Move: absolute positions = start positions + world delta; applied in a
 *   single `moveObjects` transaction per frame (rAF-throttled).
 * - Resize: `resizeRect` on the bounding box → `clampScale` against each
 *   object's minimum size and the global maximum → `scaleWithin` each object.
 * - The first movement past DRAG_THRESHOLD_PX on a move also brings the whole
 *   selection to the front (relative order preserved).
 * - `pointercancel` keeps the last applied state; `pointerup` applies the
 *   final exact position and ends the gesture.
 */
export interface TransformGesture {
  /** True while a move/resize gesture is in progress (hides the bar). */
  active: boolean;
  /**
   * Start a group-move with exactly the given ids. The parent computes the
   * post-click selection (plain click → `[id]`; shift-click → current set ± id)
   * because the selection state may be one render stale inside the closure.
   */
  onObjectPointerDown: (e: PointerEvent, ids: string[]) => void;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

interface GestureOptions {
  doc: Y.Doc;
  camera: Camera;
  objects: readonly ObjectSnapshot[];
  selectedIds: ReadonlySet<string>;
  canEdit: boolean;
  /** Called once when a gesture starts and once when it ends. */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

export interface GestureState {
  mode: 'move' | 'resize';
  handle: Handle | null;
  startScreen: Point;
  lastScreen: Point;
  ids: string[];
  startPositions: Map<string, Point>;
  startRects: Map<string, Rect>;
  startBox: Rect | null;
  aspectLocked: boolean;
  minSizes: number[];
  moved: boolean;
  rafId: number;
}

export function useTransformGesture({
  doc,
  camera,
  objects,
  selectedIds,
  canEdit,
  onGestureStart,
  onGestureEnd,
}: GestureOptions): TransformGesture {
  const [active, setActive] = useState(false);
  const stateRef = useRef<GestureState | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const finish = useCallback((applyFinal: boolean) => {
    const st = stateRef.current;
    if (!st) return;
    stateRef.current = null;
    if (st.rafId) {
      cancelAnimationFrame(st.rafId);
      st.rafId = 0;
    }
    if (applyFinal && st.moved) applyFrame(st, cameraRef.current, docRef.current);
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowCancel);
    setActive(false);
    onGestureEndRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindowMove = (e: PointerEvent) => {
    const st = stateRef.current;
    if (!st) return;
    st.lastScreen = { x: e.clientX, y: e.clientY };
    const screenDist = Math.hypot(e.clientX - st.startScreen.x, e.clientY - st.startScreen.y);
    if (!st.moved && screenDist < DRAG_THRESHOLD_PX) return;
    if (!st.moved) {
      st.moved = true;
      if (st.mode === 'move') bringObjectsToFront(docRef.current, st.ids);
    }
    if (st.rafId) return;
    st.rafId = requestAnimationFrame(() => {
      const s = stateRef.current;
      if (!s) return;
      s.rafId = 0;
      applyFrame(s, cameraRef.current, docRef.current);
    });
  };

  const onWindowUp = () => {
    finish(true);
  };

  const onWindowCancel = () => {
    finish(false);
  };

  const begin = useCallback(
    (e: PointerEvent, mode: 'move' | 'resize', handle: Handle | null, ids: string[]) => {
      if (!canEdit || stateRef.current) return;
      const shiftHeld = e.shiftKey;
      const byId = new Map(objects.map((o) => [o.id, o]));
      const idSet = new Set(ids);
      const rects: Map<string, Rect> = new Map();
      const positions: Map<string, Point> = new Map();
      const list: Rect[] = [];
      const minSizes: number[] = [];
      let aspectLocked = false; // "any spec aspectLocked" (or Shift held)
      for (const id of idSet) {
        const o = byId.get(id);
        if (!o) continue;
        const r = objectBounds(o);
        rects.set(id, r);
        positions.set(id, { x: o.x, y: o.y });
        list.push(r);
        const spec = getObjectType(o.type);
        minSizes.push(spec?.minSize ?? 0);
        if (spec && spec.aspectLocked) aspectLocked = true;
      }
      if (shiftHeld) aspectLocked = true;
      if (rects.size === 0) return;
      stateRef.current = {
        mode,
        handle,
        startScreen: { x: e.clientX, y: e.clientY },
        lastScreen: { x: e.clientX, y: e.clientY },
        ids: [...rects.keys()],
        startPositions: positions,
        startRects: rects,
        startBox: mode === 'resize' ? unionRects(list) : null,
        aspectLocked: mode === 'resize' ? aspectLocked : false,
        minSizes,
        moved: false,
        rafId: 0,
      };
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowCancel);
      setActive(true);
      onGestureStartRef.current?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [canEdit, objects, selectedIds],
  );

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, ids: string[]) => {
      begin(e, 'move', null, ids);
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      e.stopPropagation();
      begin(e, 'resize', handle, [...selectedIds]);
    },
    [begin, selectedIds],
  );

  return { active, onObjectPointerDown, onHandlePointerDown };
}

/**
 * Apply the current pointer delta (start → lastScreen) as one moveObjects or
 * resizeObjects transaction. Pure-ish: reads the gesture state, writes the doc.
 */
export function applyFrame(st: GestureState, camera: Camera, doc: Y.Doc): void {
  const dx = (st.lastScreen.x - st.startScreen.x) / camera.zoom;
  const dy = (st.lastScreen.y - st.startScreen.y) / camera.zoom;

  if (st.mode === 'move') {
    const positions = new Map<string, Point>();
    for (const id of st.ids) {
      const p = st.startPositions.get(id);
      if (!p) continue;
      positions.set(id, { x: p.x + dx, y: p.y + dy });
    }
    moveObjects(doc, positions);
    return;
  }

  if (!st.startBox || !st.handle) return;
  const box = resizeRect(st.startBox, st.handle, { x: dx, y: dy }, st.aspectLocked);
  const scale = {
    x: st.startBox.width > 0 ? box.width / st.startBox.width : 1,
    y: st.startBox.height > 0 ? box.height / st.startBox.height : 1,
  };
  const startRects = [...st.startRects.values()];
  const clamped = clampScale(scale, startRects, st.minSizes, MAX_OBJECT_SIZE_WORLD);
  const w = st.startBox.width * clamped.x;
  const h = st.startBox.height * clamped.y;
  const finalBox: Rect = {
    x: st.handle.includes('w') ? st.startBox.x + st.startBox.width - w : st.startBox.x,
    y: st.handle.includes('n') ? st.startBox.y + st.startBox.height - h : st.startBox.y,
    width: w,
    height: h,
  };
  const rects = new Map<string, Rect>();
  for (const [id, r] of st.startRects) {
    rects.set(id, scaleWithin(r, st.startBox, finalBox));
  }
  resizeObjects(doc, rects);
}
