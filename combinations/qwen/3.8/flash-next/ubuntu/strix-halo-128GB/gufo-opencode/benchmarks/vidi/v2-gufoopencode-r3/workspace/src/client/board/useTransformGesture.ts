import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionController } from './useSelection';

export type ResizeHandle = Handle;

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  objects: readonly ObjectSnapshot[];
  selection: SelectionController;
  // False on a load-failed board: gestures are ignored entirely (TC-25).
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface GestureEntry {
  id: string;
  rect: Rect;
  minSize: number;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  // Camera zoom captured at pointerdown; the pointer grabs world coordinates
  // at this scale and zoom changes mid-gesture stay harmless.
  zoom: number;
  active: boolean;
  ended: boolean;
  entries: GestureEntry[];
  from: Rect | null;
  handle: Handle | null;
  aspect: boolean;
  pending: Point | null;
  raf: number | null;
}

// Apply the pending pointer delta for the current animation frame (moves) or
// compute and write the clamped bounding-box scale (resizes).
function applyGesture(doc: Y.Doc, g: Gesture): void {
  if (g.pending === null || g.entries.length === 0) return;
  const { x: dwx, y: dwy } = g.pending;
  if (g.kind === 'move') {
    const positions = new Map<string, Point>();
    for (const e of g.entries) {
      positions.set(e.id, { x: e.rect.x + dwx, y: e.rect.y + dwy });
    }
    moveObjects(doc, positions);
    return;
  }
  if (g.from === null || g.handle === null) return;
  const from = g.from;
  const raw = resizeRect(from, g.handle, { x: dwx, y: dwy }, g.aspect);
  const scaleRaw: Point = {
    x: from.width > 0 ? raw.width / from.width : 1,
    y: from.height > 0 ? raw.height / from.height : 1
  };
  const rects = g.entries.map((e) => e.rect);
  const minSizes = g.entries.map((e) => e.minSize);
  const clamped = clampScale(scaleRaw, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
  // Re-derive the handle delta that produces exactly the clamped scale, so
  // the first object to hit a min/max limit stops the whole selection. The
  // map from delta to scale is linear per axis, so scaling the delta by the
  // ratio of scale offsets gives the clamped result directly.
  const adjusted: Point = {
    x: scaleRaw.x === 1 ? 0 : dwx * ((clamped.x - 1) / (scaleRaw.x - 1)),
    y: scaleRaw.y === 1 ? 0 : dwy * ((clamped.y - 1) / (scaleRaw.y - 1))
  };
  const to = resizeRect(from, g.handle, adjusted, g.aspect);
  const rectsOut = new Map<string, Rect>();
  for (const e of g.entries) {
    rectsOut.set(e.id, scaleWithin(e.rect, from, to));
  }
  resizeObjects(doc, rectsOut);
}

// Generic press-drag gesture for all registered object types: group move
// from any selected object body, and bounding-box resize from overlay
// handles. Selection changes are local; only absolute object writes hit the
// Y.Doc (one transaction per rAF frame at most).
export function useTransformGesture(options: TransformGestureOptions) {
  const latest = useRef(options);
  latest.current = options;
  const gestureRef = useRef<Gesture | null>(null);

  const listenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  const stopListening = () => {
    const l = listenersRef.current;
    if (l === null) return;
    window.removeEventListener('pointermove', l.move);
    window.removeEventListener('pointerup', l.up);
    window.removeEventListener('pointercancel', l.cancel);
    listenersRef.current = null;
  };

  const startListening = () => {
    stopListening();
    const move = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g === null || e.pointerId !== g.pointerId) return;
      const dpx = e.clientX - g.startX;
      const dpy = e.clientY - g.startY;
      if (!g.active) {
        if (Math.hypot(dpx, dpy) < DRAG_THRESHOLD_PX) return; // stay Pressed
        activate(g);
      }
      g.pending = { x: dpx / g.zoom, y: dpy / g.zoom };
      if (g.raf === null) {
        g.raf = requestAnimationFrame(() => {
          const cur = gestureRef.current;
          if (cur === null) return;
          cur.raf = null;
          applyGesture(latest.current.doc, cur);
        });
      }
    };
    const finish = (flush: boolean) => {
      const g = gestureRef.current;
      if (g === null) return;
      if (g.raf !== null) cancelAnimationFrame(g.raf);
      g.raf = null;
      if (flush && g.active) applyGesture(latest.current.doc, g);
      gestureRef.current = null;
      stopListening();
      if (g.active && !g.ended) {
        g.ended = true;
        latest.current.onGestureEnd?.();
      }
    };
    const up = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g === null || e.pointerId !== g.pointerId) return;
      finish(true);
    };
    const cancel = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (g === null || e.pointerId !== g.pointerId) return;
      // pointercancel freezes at the last applied state (no flush).
      finish(false);
    };
    listenersRef.current = { move, up, cancel };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // Crossed the drag threshold: snapshot the selection and object rects at
  // this moment, raise the selection, and announce the gesture.
  const activate = (g: Gesture) => {
    const { doc, objects, selection } = latest.current;
    if (g.kind === 'move') {
      const ids = [...selection.ids];
      g.entries = ids.flatMap((id) => {
        const o = objects.find((c) => c.id === id);
        return o ? [{ id, rect: objectBounds(o), minSize: minSizeOf(o) }] : [];
      });
      if (g.entries.length === 0) {
        // Selection vanished at the exact threshold: nothing to move.
        g.pending = null;
      }
      bringObjectsToFront(doc, g.entries.map((e) => e.id));
      g.active = true;
      latest.current.onGestureStart?.();
      return;
    }
    g.active = true;
    latest.current.onGestureStart?.();
  };

  useEffect(() => stopListening, []);

  const onObjectPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    const { canEdit, selection } = latest.current;
    if (!canEdit || e.button !== 0) return;
    if (e.shiftKey) {
      selection.toggle(id);
      return; // Shift+click toggles; it never starts a gesture
    }
    if (!selection.ids.has(id)) selection.click(id);
    gestureRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      zoom: latest.current.camera.zoom,
      active: false,
      ended: false,
      entries: [],
      from: null,
      handle: null,
      aspect: false,
      pending: null,
      raf: null
    };
    startListening();
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLElement>, handle: Handle) => {
    e.stopPropagation();
    const { objects, selection, canEdit } = latest.current;
    if (!canEdit || e.button !== 0) return;
    const selected = [...selection.ids].flatMap((id) => {
      const o = objects.find((c) => c.id === id);
      return o ? [{ o, bounds: objectBounds(o) }] : [];
    });
    if (selected.length === 0) return;
    if (!selected.some(({ o }) => getObjectType(o.type)?.resizable === true)) return;
    const aspect =
      e.shiftKey || selected.some(({ o }) => getObjectType(o.type)?.aspectLocked === true);
    const entries: GestureEntry[] = selected.map(({ o, bounds }) => ({
      id: o.id,
      rect: bounds,
      minSize: minSizeOf(o)
    }));
    gestureRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      zoom: latest.current.camera.zoom,
      active: false,
      ended: false,
      entries,
      from: unionRects(entries.map((en) => en.rect)),
      handle,
      aspect,
      pending: null,
      raf: null
    };
    startListening();
  };

  return { onObjectPointerDown, onHandlePointerDown };
}

function minSizeOf(obj: ObjectSnapshot): number {
  return getObjectType(obj.type)?.minSize ?? 0;
}
