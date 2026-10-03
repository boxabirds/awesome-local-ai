// The one transform gesture for every object type (story 7).
//
// Pressing an object body moves the whole selection; pressing a resize handle
// resizes it. Both are the same gesture: record the selection's bounds at press,
// then on each pointer-move (throttled to a frame) write new geometry computed
// *from the press state* — never incrementally — so a drag is exact and a remote
// change in the middle cannot compound. Per-object offsets from the group box are
// preserved (`scaleWithin`), which is what "the layout is not squashed" means.
//
// Sticky notes keep their square ratio (their type is `aspectLocked`), so a corner
// always scales evenly and an edge still changes the side length (never width-only).
// Holding Shift locks the ratio for any other type. Nothing here is specific to
// sticky notes: `resizable` / `aspectLocked` / `minSize` all come from the registry.

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

interface GestureStart {
  /** Objects being transformed (ids still present at press time). */
  ids: string[];
  /** Each object's bounds at press, keyed by id. */
  startRects: Map<string, Rect>;
  /** Union of `startRects`. */
  startBox: Rect;
  /** Smallest side per id (parallel to `ids`), from each object's type. */
  minSizes: number[];
  kind: 'move' | 'resize';
  handle: Handle;
  /** Whether this drag keeps the width-to-height ratio. */
  aspect: boolean;
  startClientX: number;
  startClientY: number;
  /** Pointer position of the latest move, in client pixels. */
  clientX: number;
  clientY: number;
  /** True once the drag crossed the threshold and made its first write. */
  wrote: boolean;
}

export interface TransformGesture {
  /** Press on an object body: select it (if needed) and prepare to move. */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Press on a resize handle: prepare to resize the whole selection. */
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

const X_EDGE = new Set<Handle>(['e', 'w', 'ne', 'se', 'nw', 'sw']);
const Y_EDGE = new Set<Handle>(['n', 's', 'ne', 'se', 'nw', 'sw']);
const LEFT = new Set<Handle>(['w', 'nw', 'sw']);
const TOP = new Set<Handle>(['n', 'ne', 'nw']);

/** A resize box of a given size, anchored where `resizeRect` would anchor it. */
function anchoredBox(start: Rect, handle: Handle, w: number, h: number): Rect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  let x = LEFT.has(handle) ? right - w : start.x;
  let y = TOP.has(handle) ? bottom - h : start.y;
  if (start.width > 0 && X_EDGE.has(handle) && !Y_EDGE.has(handle)) y = cy - h / 2;
  if (start.height > 0 && Y_EDGE.has(handle) && !X_EDGE.has(handle)) x = cx - w / 2;
  return { x, y, width: w, height: h };
}

export interface UseTransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Fired once, before the first write, when a drag actually starts moving. */
  onGestureStart?(): void;
  /** Fired once when a drag that wrote something ends. */
  onGestureEnd?(): void;
}

/**
 * The transform gesture. The two pointer-down entry points arm a gesture; move / up
 * / cancel are handled by window listeners that stay attached for the component's
 * life and no-op while no gesture is armed (so the pointer can leave the object).
 * `onGestureStart` / `onGestureEnd` fire exactly once per drag that actually moved,
 * so the caller can pause remote-applied changes around it (sync-merge).
 */
export function useTransformGesture(
  opts: UseTransformGestureOptions,
): TransformGesture {
  // Latest props, read by the (otherwise stable) window handlers so a drag never
  // uses a stale camera, snapshot, selection or callback.
  const live = useRef(opts);
  live.current = opts;

  const gesture = useRef<GestureStart | null>(null);
  const frame = useRef(0);

  // Compute a fresh write from the press state and the latest pointer position.
  const write = useCallback(() => {
    frame.current = 0;
    const g = gesture.current;
    if (!g) return;
    const { doc, camera } = live.current;
    const zoom = camera.zoom || 1;
    const dx = (g.clientX - g.startClientX) / zoom;
    const dy = (g.clientY - g.startClientY) / zoom;

    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const id of g.ids) {
        const r = g.startRects.get(id);
        if (r) positions.set(id, { x: r.x + dx, y: r.y + dy });
      }
      moveObjects(doc, positions);
      return;
    }

    // resize: scale the selection box, clamp to every object's min size, then
    // reposition each object by its offset from the box (layout preserved).
    const to = resizeRect(g.startBox, g.handle, { x: dx, y: dy }, g.aspect);
    const scale = {
      x: g.startBox.width > 0 ? to.width / g.startBox.width : 1,
      y: g.startBox.height > 0 ? to.height / g.startBox.height : 1,
    };
    const rects: Rect[] = [];
    for (const id of g.ids) {
      const r = g.startRects.get(id);
      if (r) rects.push(r);
    }
    const clamped = clampScale(scale, rects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
    // `clamped` is a scale factor relative to the press box; turn it back into a
    // box anchored at the dragged handle's fixed edge, then map every object into
    // it (so the relative layout is preserved while the whole thing stops together
    // at the first object that reaches a min / max).
    const box = anchoredBox(
      g.startBox,
      g.handle,
      g.startBox.width * clamped.x,
      g.startBox.height * clamped.y,
    );
    const writes = new Map<string, Rect>();
    for (const id of g.ids) {
      const r = g.startRects.get(id);
      if (r) writes.set(id, scaleWithin(r, g.startBox, box));
    }
    resizeObjects(doc, writes);
  }, []);

  const schedule = useCallback(() => {
    if (frame.current) return; // one write per frame
    frame.current = requestAnimationFrame(write);
  }, [write]);

  const finish = useCallback(() => {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      write(); // apply the very last position before releasing
    }
    const wasDragging = gesture.current?.wrote ?? false;
    gesture.current = null;
    if (wasDragging) live.current.onGestureEnd?.();
  }, [write]);

  // A single set of window listeners for the component's life, gated on an armed
  // gesture. They are attached before any move can arrive (the pointer-down that
  // arms the gesture is handled by the entry points below, on the object/handle).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;
      if (!g.wrote) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a possible click
        g.wrote = true;
        live.current.onGestureStart?.();
        if (g.kind === 'move') bringObjectsToFront(live.current.doc, g.ids);
      }
      g.clientX = e.clientX;
      g.clientY = e.clientY;
      schedule();
    };
    const onUp = () => {
      if (gesture.current) finish();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [schedule, finish]);

  // Assemble the press state common to move and resize.
  const arm = useCallback(
    (
      e: ReactPointerEvent<HTMLElement>,
      ids: string[],
      kind: 'move' | 'resize',
      handle: Handle,
      aspect: boolean,
    ): void => {
      const { snapshot } = live.current;
      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (!obj) continue;
        startRects.set(id, objectBounds(obj));
        minSizes.push(getObjectType(obj.type)?.minSize ?? STICKY_MIN_SIZE_WORLD);
      }
      if (startRects.size === 0) return;
      const startBox = unionRects([...startRects.values()]);
      if (!startBox) return;
      gesture.current = {
        ids: [...startRects.keys()],
        startRects,
        startBox,
        minSizes,
        kind,
        handle,
        aspect,
        startClientX: e.clientX,
        startClientY: e.clientY,
        clientX: e.clientX,
        clientY: e.clientY,
        wrote: false,
      };
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string) => {
      const { selection, snapshot, canEdit } = live.current;
      // A board we cannot load-lock does nothing at all (persist.client_status).
      if (!canEdit) return;
      e.stopPropagation();
      // A Shift-click only adds or removes this object from the selection; it does
      // not begin a move (a group is moved by pressing it without Shift).
      if (e.shiftKey) {
        selection.toggle(id);
        return;
      }
      const present = new Set(snapshot.map((o) => o.id));
      const already = selection.ids.has(id);
      // Pressing an object that is not part of the selection selects only it.
      if (!already) selection.click(id);
      const ids = (already ? [...selection.ids] : [id]).filter((i) => present.has(i));
      arm(e, ids, 'move', 'se', false);
    },
    [arm],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle) => {
      const { selection, snapshot, canEdit } = live.current;
      if (!canEdit) return;
      e.stopPropagation();
      const present = new Set(snapshot.map((o) => o.id));
      const objs = [...selection.ids]
        .filter((i) => present.has(i))
        .map((i) => snapshot.find((o) => o.id === i))
        .filter((o): o is ObjectSnapshot => o !== undefined);
      // Handles only appear for resizable types; ignore a press if none applies.
      if (!objs.some((o) => getObjectType(o.type)?.resizable)) return;
      // Shift locks the ratio for any type; a type that is inherently aspect-locked
      // (sticky) is always scaled evenly.
      const aspect = e.shiftKey || objs.some((o) => getObjectType(o.type)?.aspectLocked);
      arm(e, objs.map((o) => o.id), 'resize', handle, aspect);
    },
    [arm],
  );

  return useMemo(
    () => ({ onObjectPointerDown, onHandlePointerDown }),
    [onObjectPointerDown, onHandlePointerDown],
  );
}
