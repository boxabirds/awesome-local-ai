/**
 * Generic transform gesture: group move and bounding-box resize.
 *
 * Absolute writes: each frame writes the absolute position/rect computed from the
 * gesture-start snapshot + accumulated delta, not incremental deltas (key decision 1).
 * This converges correctly when a remote user moves the same object concurrently.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { setTextWidthFixed } from '../../shared/objects/text';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { SelectionController } from './useSelection';
import { getObjectType } from '../objects/registry';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionController;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  onDragStateChange?(draggingId: string | null): void;
}

export interface TransformGestureResult {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
}

interface MoveGesture {
  type: 'move';
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  startRects: Map<string, Rect>;
  ids: string[];
  started: boolean;
  frame: number | null;
}

interface ResizeGesture {
  type: 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  startRects: Map<string, Rect>;
  ids: string[];
  startBBox: Rect;
  handle: Handle;
  aspectLocked: boolean;
  started: boolean;
  frame: number | null;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureResult {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd, onDragStateChange } = opts;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const activeRef = useRef<MoveGesture | ResizeGesture | null>(null);

  const cleanup = useCallback(() => {
    const g = activeRef.current;
    if (g && g.frame !== null) {
      cancelAnimationFrame(g.frame);
    }
    activeRef.current = null;
    onDragStateChangeRef.current?.(null);
  }, []);

  const applyMove = useCallback(() => {
    const g = activeRef.current;
    if (!g || g.type !== 'move' || !g.started) return;
    if (!canEditRef.current) return;
    const cam = cameraRef.current;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const worldDx = (g.latestX - g.startX) / zoom;
    const worldDy = (g.latestY - g.startY) / zoom;

    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, rect] of g.startRects) {
      positions.set(id, { x: rect.x + worldDx, y: rect.y + worldDy });
    }
    moveObjects(doc, positions);
  }, [doc]);

  const applyResize = useCallback(() => {
    const g = activeRef.current;
    if (!g || g.type !== 'resize' || !g.started) return;
    if (!canEditRef.current) return;
    const cam = cameraRef.current;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const worldDx = (g.latestX - g.startX) / zoom;
    const worldDy = (g.latestY - g.startY) / zoom;

    const newBBox = resizeRect(g.startBBox, g.handle, { x: worldDx, y: worldDy }, g.aspectLocked);

    const scaleX = g.startBBox.width > 0 ? newBBox.width / g.startBBox.width : 1;
    const scaleY = g.startBBox.height > 0 ? newBBox.height / g.startBBox.height : 1;

    const rects: Rect[] = [];
    const minSizes: number[] = [];
    for (const id of g.ids) {
      const startRect = g.startRects.get(id);
      if (!startRect) continue;
      rects.push(startRect);
      const obj = snapshotRef.current.find((o) => o.id === id);
      const spec = obj ? getObjectType(obj.type) : undefined;
      minSizes.push(spec?.minSize ?? 0);
    }

    const scaleForClamp = g.aspectLocked ? { x: scaleX, y: scaleX } : { x: scaleX, y: scaleY };
    const clamped = clampScale(scaleForClamp, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    const finalWidth = g.startBBox.width * clamped.x;
    const finalHeight = g.startBBox.height * clamped.y;
    const finalBBox: Rect = {
      x: g.startBBox.x,
      y: g.startBBox.y,
      width: finalWidth,
      height: finalHeight,
    };
    if (g.handle.includes('w')) finalBBox.x = g.startBBox.x + g.startBBox.width - finalWidth;
    if (g.handle.includes('n')) finalBBox.y = g.startBBox.y + g.startBBox.height - finalHeight;

    // Every other type takes its scaled rect. A text object is the exception (design key
    // decision 2): its height belongs to its content, and its font is a choice the handles never
    // make. So a text is always repositioned with the group, given a width only when the drag came
    // from a side - always for a side handle, and for a text that already has a width of its own -
    // and the height is then re-measured by `useTextBoxSync`, which wraps.
    const horizontal = g.handle === 'e' || g.handle === 'w';
    const dragsWidth = g.handle.includes('e') || g.handle.includes('w');
    const group = new Map<string, Rect>();
    const moved = new Map<string, { x: number; y: number }>();
    const widths = new Map<string, number>();
    for (const [id, startRect] of g.startRects) {
      const rect = scaleWithin(startRect, g.startBBox, finalBBox);
      const object = snapshotRef.current.find((o) => o.id === id);
      if (object && object.type === 'text') {
        moved.set(id, { x: rect.x, y: rect.y });
        if (horizontal || (object.widthMode === 'fixed' && dragsWidth)) widths.set(id, rect.width);
        continue;
      }
      group.set(id, rect);
    }
    resizeObjects(doc, group);
    if (moved.size > 0) moveObjects(doc, moved);
    for (const [id, width] of widths) setTextWidthFixed(doc, id, width);
  }, [doc]);

  /** Attaches window-level move/up/cancel listeners for a move gesture. */
  const attachMoveListeners = useCallback(() => {
    const onMove = (moveEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.type !== 'move' || g.pointerId !== moveEvent.pointerId) return;
      g.latestX = moveEvent.clientX;
      g.latestY = moveEvent.clientY;

      if (!g.started) {
        const dx = moveEvent.clientX - g.startX;
        const dy = moveEvent.clientY - g.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        g.started = true;
        // Story 8: the step starts before the first write, so raising the note to the front is
        // part of the same step as the move that caused it - one undo takes both back.
        onGestureStartRef.current?.();
        bringObjectsToFront(doc, g.ids);
        onDragStateChangeRef.current?.(g.ids[0] ?? null);
      }

      if (g.frame === null) {
        g.frame = requestAnimationFrame(() => {
          const gg = activeRef.current;
          if (gg) gg.frame = null;
          applyMove();
        });
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.pointerId !== upEvent.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (g.type === 'move' && g.started) {
        g.latestX = upEvent.clientX;
        g.latestY = upEvent.clientY;
        applyMove();
        onGestureEndRef.current?.();
      }
      cleanup();
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.pointerId !== cancelEvent.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (g.type === 'move' && g.started) {
        onGestureEndRef.current?.();
      }
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [applyMove, cleanup, doc]);

  const onObjectPointerDown = useCallback((e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sel = selectionRef.current;

    // Shift-click toggles selection only, no gesture
    if (e.shiftKey) {
      sel.toggle(id);
      return;
    }

    // If not selected, select only this one and use [id] as the ids array
    if (!sel.ids.has(id)) {
      sel.click(id);
      if (!canEditRef.current) return;
      const ids = [id];
      const startRects = new Map<string, Rect>();
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (obj) startRects.set(id, objectBounds(obj));

      activeRef.current = {
        type: 'move',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        latestX: e.clientX,
        latestY: e.clientY,
        startRects,
        ids,
        started: false,
        frame: null,
      };
      attachMoveListeners();
      return;
    }

    if (!canEditRef.current) return;

    // Already selected: group move with current selection
    const ids = [...sel.ids];
    const startRects = new Map<string, Rect>();
    for (const oid of ids) {
      const obj = snapshotRef.current.find((o) => o.id === oid);
      if (obj) startRects.set(oid, objectBounds(obj));
    }

    activeRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      latestX: e.clientX,
      latestY: e.clientY,
      startRects,
      ids,
      started: false,
      frame: null,
    };
    attachMoveListeners();
  }, [attachMoveListeners]);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent, handle: Handle) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!canEditRef.current) return;

    const sel = selectionRef.current;
    const ids = [...sel.ids];
    if (ids.length === 0) return;

    let anyResizable = false;
    let anyAspectLocked = false;
    for (const id of ids) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (!spec) continue;
      if (spec.resizable) anyResizable = true;
      if (spec.aspectLocked) anyAspectLocked = true;
    }
    if (!anyResizable) return;

    const aspectLocked = anyAspectLocked || e.shiftKey;

    const rects: Rect[] = [];
    const startRects = new Map<string, Rect>();
    for (const id of ids) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (!obj) continue;
      const r = objectBounds(obj);
      rects.push(r);
      startRects.set(id, r);
    }
    const bbox = unionRects(rects);
    if (!bbox) return;

    activeRef.current = {
      type: 'resize',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      latestX: e.clientX,
      latestY: e.clientY,
      startRects,
      ids,
      startBBox: bbox,
      handle,
      aspectLocked,
      started: true,
      frame: null,
    };

    onGestureStartRef.current?.();

    const onMove = (moveEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.type !== 'resize' || g.pointerId !== moveEvent.pointerId) return;
      g.latestX = moveEvent.clientX;
      g.latestY = moveEvent.clientY;
      if (g.frame === null) {
        g.frame = requestAnimationFrame(() => {
          const gg = activeRef.current;
          if (gg) gg.frame = null;
          applyResize();
        });
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.pointerId !== upEvent.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      g.latestX = upEvent.clientX;
      g.latestY = upEvent.clientY;
      applyResize();
      onGestureEndRef.current?.();
      cleanup();
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      const g = activeRef.current;
      if (!g || g.pointerId !== cancelEvent.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      onGestureEndRef.current?.();
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [applyResize, cleanup]);

  return { onObjectPointerDown, onHandlePointerDown };
}
