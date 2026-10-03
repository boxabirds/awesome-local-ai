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
  type TextSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
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
import { getHandles, getObjectType } from '../objects/registry';
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
  /**
   * Every object in the drag is a horizontal-only type (free text): the drag can only
   * change a width, and each object's height is re-measured from its own content
   * rather than scaled (text.fixed_width).
   */
  horizontal: boolean;
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

    // resize of horizontal-only objects (one text object): the dragged side moves and
    // the opposite edge stays put, the width is clamped to the type's minimum, and the
    // height is left to the object's own re-measure — a text object's height is its
    // content, never a dragged number.
    if (g.kind === 'resize' && g.horizontal) {
      const positions = new Map<string, Point>();
      for (const id of g.ids) {
        const r = g.startRects.get(id);
        if (!r) continue;
        const type = live.current.snapshot.find((o) => o.id === id)?.type ?? '';
        const min = getObjectType(type)?.minSize ?? STICKY_MIN_SIZE_WORLD;
        const dragLeft = LEFT.has(g.handle);
        const raw = dragLeft ? r.width - dx : r.width + dx;
        const width = Math.max(min, Math.min(MAX_OBJECT_SIZE_WORLD, raw));
        positions.set(id, { x: dragLeft ? r.x + r.width - width : r.x, y: r.y });
        // Also switches the object to a fixed width, so it stops hugging its content
        // (the state diagram's AutoWidth -> FixedWidth transition).
        setTextWidthFixed(doc, id, width);
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
    if (g.aspect) {
      // A locked ratio is one scale, not two.
      //
      // `clampScale` clamps each axis on its own, which is right for a box that is free to change shape
      // and wrong for one that is not: a picture twice as wide as it is tall, dragged far enough
      // inwards, lands on 16x16 — the height reaches its minimum at a scale of 0.05 and the width
      // reaches the same minimum at 0.02, so the two halves of the drag stop at two different places
      // and what is left is a square. The drag has stopped at the smallest size and destroyed the ratio
      // it was asked to keep. Whichever axis runs out of room first is the one that stops the drag, and
      // the other one comes with it: the box stops at the floor with its shape.
      const uniform =
        scale.x <= 1 ? Math.max(clamped.x, clamped.y) : Math.min(clamped.x, clamped.y);
      clamped.x = uniform;
      clamped.y = uniform;
    }
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
      if (!r) continue;
      const scaled = scaleWithin(r, g.startBox, box);
      const obj = live.current.snapshot.find((o) => o.id === id);
      if (obj?.type === 'text') {
        // A text object in a mixed group is *repositioned* with everything else; its
        // font size never changes, and neither does the width of an auto-width object
        // (its box hugs its content). A fixed-width one keeps the width the drag gave
        // it, and its height is re-measured from its content by its own box sync — so
        // the height a group scale would have written is never kept.
        writes.set(
          id,
          (obj as TextSnapshot).widthMode === 'fixed'
            ? { x: scaled.x, y: scaled.y, width: scaled.width, height: r.height }
            : { x: scaled.x, y: scaled.y, width: r.width, height: r.height },
        );
      } else {
        writes.set(id, scaled);
      }
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
      horizontal = false,
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
        horizontal,
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
      // Only a selection made entirely of horizontal-only types drags sideways: as
      // soon as a sticky is in the group the box is scaled on both axes again, and the
      // text is repositioned with everything else (its font size never changes).
      const horizontal = objs.every((o) => getHandles(o.type) === 'horizontal');
      arm(e, objs.map((o) => o.id), 'resize', handle, aspect, horizontal);
    },
    [arm],
  );

  return useMemo(
    () => ({ onObjectPointerDown, onHandlePointerDown }),
    [onObjectPointerDown, onHandlePointerDown],
  );
}
