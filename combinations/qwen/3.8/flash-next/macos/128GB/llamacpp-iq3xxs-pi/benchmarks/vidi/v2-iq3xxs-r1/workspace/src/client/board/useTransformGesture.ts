import { useRef, useCallback, useState } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  type ObjectSnapshot,
  type WorldPoint,
} from '../../shared/board-model';
import {
  unionRects,
  resizeRect,
  clampScale,
  scaleWithin,
  type Rect,
  type Handle,
  type Point,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  type: 'press' | 'move' | 'resize';
  handle?: Handle;
  /** Ids that were selected (captured at pointerdown, before async state updates). */
  selectedIds: string[];
  startRects: Map<string, Rect>;
  boundingBox: Rect;
  aspectLocked: boolean;
}

export interface TransformGestureHandlers {
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
  /** Set of ids currently being dragged (state, triggers re-render). */
  readonly draggingIds: ReadonlySet<string>;
}

/**
 * Generic transform gesture: group move and bounding-box resize.
 * Uses absolute writes (start + delta) for convergence.
 */
export function useTransformGesture(opts: TransformGestureOptions): TransformGestureHandlers {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gestureRef = useRef<GestureState | null>(null);
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(new Set());

  const flushMove = useCallback(() => {
    frameRef.current = null;
    const g = gestureRef.current;
    const pending = pendingRef.current;
    if (!g || !pending) return;
    pendingRef.current = null;
    const { doc, camera } = optsRef.current;
    if (!doc || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
    const dxWorld = pending.dx / camera.zoom;
    const dyWorld = pending.dy / camera.zoom;
    const positions = new Map<string, WorldPoint>();
    for (const [id, rect] of g.startRects) {
      positions.set(id, { x: rect.x + dxWorld, y: rect.y + dyWorld });
    }
    moveObjects(doc, positions);
  }, []);

  const flushResize = useCallback(() => {
    frameRef.current = null;
    const g = gestureRef.current;
    const pending = pendingRef.current;
    if (!g || !pending || !g.handle) return;
    pendingRef.current = null;
    const { doc, camera, snapshot } = optsRef.current;
    if (!doc || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
    const dxWorld = pending.dx / camera.zoom;
    const dyWorld = pending.dy / camera.zoom;
    const delta: Point = { x: dxWorld, y: dyWorld };
    const newBox = resizeRect(g.boundingBox, g.handle, delta, g.aspectLocked);
    // Compute scale
    const sx = g.boundingBox.width > 0 ? newBox.width / g.boundingBox.width : 1;
    const sy = g.boundingBox.height > 0 ? newBox.height / g.boundingBox.height : 1;
    // Clamp
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    for (const [, rect] of g.startRects) {
      rects.push(rect);
    }
    const ids = [...g.startRects.keys()];
    for (const id of ids) {
      const obj = snapshot.find((o) => o.id === id);
      const typeSpec = obj ? getObjectType(obj.type) : undefined;
      minSizes.push(typeSpec?.minSize ?? 10);
    }
    const clamped = clampScale({ x: sx, y: sy }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    // Apply scaleWithin for each object
    const finalBox: Rect = {
      x: g.boundingBox.x,
      y: g.boundingBox.y,
      width: g.boundingBox.width * clamped.x,
      height: g.boundingBox.height * clamped.y,
    };
    // Adjust position based on handle
    if (g.handle.includes('w')) finalBox.x = g.boundingBox.x + g.boundingBox.width * (1 - clamped.x);
    if (g.handle === 'n' || g.handle === 'nw' || g.handle === 'ne')
      finalBox.y = g.boundingBox.y + g.boundingBox.height * (1 - clamped.y);

    const resizeMap = new Map<string, Rect>();
    for (const [id, rect] of g.startRects) {
      const scaled = scaleWithin(rect, g.boundingBox, finalBox);
      // Enforce aspect lock for sticky notes
      const obj = snapshot.find((o) => o.id === id);
      const typeSpec = obj ? getObjectType(obj.type) : undefined;
      if (typeSpec?.aspectLocked) {
        const size = Math.max(scaled.width, scaled.height);
        scaled.width = size;
        scaled.height = size;
      }
      resizeMap.set(id, scaled);
    }
    resizeObjects(doc, resizeMap);
  }, []);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      const g = gestureRef.current;
      if (g?.type === 'move') flushMove();
      else if (g?.type === 'resize') flushResize();
    });
  }, [flushMove, flushResize]);

  const onObjectPointerDown = useCallback((e: PointerEvent, id: string) => {
    const { canEdit } = optsRef.current;
    if (!canEdit) return;

    // Capture selection ids NOW (before async React state update)
    const selection = optsRef.current.selection;
    let selectedIds: string[];
    if (!selection.ids.has(id)) {
      selection.click(id);
      // After click(id), the selection will be {id} only; use that
      selectedIds = [id];
    } else {
      // Move all selected ids
      selectedIds = [...selection.ids];
    }

    const g: GestureState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      type: 'press',
      selectedIds,
      startRects: new Map(),
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      aspectLocked: false,
    };
    gestureRef.current = g;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      const dx = ev.clientX - g.startX;
      const dy = ev.clientY - g.startY;
      if (g.type === 'press') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        // Threshold crossed - start move
        const { doc, snapshot: snap } = optsRef.current;
        g.type = 'move';
        // Record start rects for all captured ids
        for (const objId of g.selectedIds) {
          const obj = snap.find((o) => o.id === objId);
          if (obj) g.startRects.set(objId, objectBounds(obj));
        }
        optsRef.current.onGestureStart?.();
        setDraggingIds(new Set(g.selectedIds));
        bringObjectsToFront(doc, g.selectedIds);
      }
      pendingRef.current = { dx, dy };
      scheduleFrame();
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      cleanup();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // Flush last pending
      if (g.type === 'move' && pendingRef.current) flushMove();
      pendingRef.current = null;
      gestureRef.current = null;
      setDraggingIds(new Set());
      optsRef.current.onGestureEnd?.();
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      cleanup();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // Keep last applied state; don't flush
      pendingRef.current = null;
      gestureRef.current = null;
      setDraggingIds(new Set());
      optsRef.current.onGestureEnd?.();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [scheduleFrame, flushMove]);

  const onHandlePointerDown = useCallback((e: PointerEvent, handle: Handle) => {
    const { selection, snapshot, canEdit } = optsRef.current;
    if (!canEdit) return;

    // Check if any selected type is resizable
    let anyResizable = false;
    let aspectLocked = false;
    const startRects = new Map<string, Rect>();
    const selectedIds = [...selection.ids];
    for (const id of selectedIds) {
      const obj = snapshot.find((o) => o.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec?.resizable) anyResizable = true;
      if (spec?.aspectLocked) aspectLocked = true;
      startRects.set(id, objectBounds(obj));
    }
    if (!anyResizable) return;

    // Shift also locks aspect
    if (e.shiftKey) aspectLocked = true;

    const rects = [...startRects.values()];
    const boundingBox = unionRects(rects);
    if (!boundingBox) return;

    const g: GestureState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      type: 'resize',
      handle,
      selectedIds,
      startRects,
      boundingBox,
      aspectLocked,
    };
    gestureRef.current = g;
    optsRef.current.onGestureStart?.();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      const dx = ev.clientX - g.startX;
      const dy = ev.clientY - g.startY;
      pendingRef.current = { dx, dy };
      scheduleFrame();
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      cleanup();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (pendingRef.current) flushResize();
      pendingRef.current = null;
      gestureRef.current = null;
      optsRef.current.onGestureEnd?.();
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      cleanup();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingRef.current = null;
      gestureRef.current = null;
      optsRef.current.onGestureEnd?.();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [scheduleFrame, flushResize]);

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
