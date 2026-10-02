import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '../../shared/board-model';
import type { Rect, Handle } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { UseSelectionResult } from './useSelection';
import { getObjectType } from '../objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';

export interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureResult {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  /** True while a move or resize gesture is actively in progress (past threshold). */
  isDragging: boolean;
}

interface MoveGestureState {
  type: 'move';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorld: Point;
  zoom: number;
  startRects: Map<string, { x: number; y: number }>;
  moved: boolean;
  raf: number | null;
  latestClientX: number;
  latestClientY: number;
}

interface ResizeGestureState {
  type: 'resize';
  pointerId: number;
  handle: Handle;
  startClientX: number;
  startClientY: number;
  zoom: number;
  bboxStart: Rect;
  startRects: Map<string, Rect>;
  aspectLocked: boolean;
  moved: boolean;
  raf: number | null;
  latestClientX: number;
  latestClientY: number;
}

type GestureState = MoveGestureState | ResizeGestureState | null;

/**
 * Generic transform gesture: group move and bounding-box resize.
 * Uses absolute writes from gesture start (Key decision 1).
 */
export function useTransformGesture(opts: TransformGestureOpts): TransformGestureResult {
  const gestureRef = useRef<GestureState>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [isDragging, setIsDragging] = useState(false);

  const applyMoveFrame = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.type !== 'move') return;
    g.raf = null;

    const dx = (g.latestClientX - g.startClientX) / g.zoom;
    const dy = (g.latestClientY - g.startClientY) / g.zoom;

    const positions = new Map<string, Point>();
    for (const [id, start] of g.startRects) {
      positions.set(id, { x: start.x + dx, y: start.y + dy });
    }

    const { doc, snapshot } = optsRef.current;
    // Filter to only ids still present
    const presentIds = new Set(snapshot.map((o) => o.id));
    const filtered = new Map<string, Point>();
    for (const [id, pos] of positions) {
      if (presentIds.has(id)) filtered.set(id, pos);
    }
    if (filtered.size > 0) {
      moveObjects(doc, filtered);
    }
  }, []);

  const applyResizeFrame = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.type !== 'resize') return;
    g.raf = null;

    const dx = (g.latestClientX - g.startClientX) / g.zoom;
    const dy = (g.latestClientY - g.startClientY) / g.zoom;

    const { doc, snapshot } = optsRef.current;

    // Resize the bounding box
    const newBBox = resizeRect(g.bboxStart, g.handle, { x: dx, y: dy }, g.aspectLocked);

    // Compute the scale and clamp it
    const scaleX = g.bboxStart.width === 0 ? 1 : newBBox.width / g.bboxStart.width;
    const scaleY = g.bboxStart.height === 0 ? 1 : newBBox.height / g.bboxStart.height;

    const rects: Rect[] = [];
    const minSizes: number[] = [];
    const presentIds = new Set(snapshot.map((o) => o.id));

    for (const [id, startRect] of g.startRects) {
      if (!presentIds.has(id)) continue;
      rects.push(startRect);
      // Find type for minSize
      const obj = snapshot.find((o) => o.id === id);
      const spec = obj ? getObjectType(obj.type) : undefined;
      minSizes.push(spec?.minSize ?? 0);
    }

    if (rects.length === 0) return;

    // Compute the desired new bbox after clamping
    // We need to find the clamped scale
    const scale = clampScale(
      { x: scaleX, y: scaleY },
      rects,
      minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );

    // Recompute the actual new bbox using clamped scales relative to start
    const anchorX = g.handle.includes('w') ? g.bboxStart.x + g.bboxStart.width : g.bboxStart.x;
    const anchorY = g.handle.includes('n') ? g.bboxStart.y + g.bboxStart.height : g.bboxStart.y;

    const newWidth = g.bboxStart.width * scale.x;
    const newHeight = g.bboxStart.height * scale.y;

    let finalBBox: Rect;
    if (g.handle.includes('w')) {
      finalBBox = { x: anchorX - newWidth, y: anchorY, width: newWidth, height: newHeight };
    } else if (g.handle === 'n' || g.handle === 's') {
      finalBBox = { x: g.bboxStart.x, y: g.handle.includes('n') ? anchorY - newHeight : anchorY, width: newWidth, height: newHeight };
    } else if (g.handle === 'e' || g.handle === 'w') {
      finalBBox = { x: anchorX - (g.handle.includes('w') ? newWidth : 0), y: g.bboxStart.y, width: newWidth, height: newHeight };
    } else {
      finalBBox = { x: anchorX, y: anchorY - (g.handle.includes('n') ? newHeight : 0), width: newWidth, height: newHeight };
    }

    // Handle edge cases more carefully
    // Determine anchor point (opposite corner/edge stays fixed)
    const ax = g.handle.includes('e') ? g.bboxStart.x : g.handle.includes('w') ? g.bboxStart.x + g.bboxStart.width : g.bboxStart.x;
    const ay = g.handle.includes('s') ? g.bboxStart.y : g.handle.includes('n') ? g.bboxStart.y + g.bboxStart.height : g.bboxStart.y;

    let fx: number, fy: number;
    if (g.handle.includes('w')) {
      fx = ax - newWidth;
    } else {
      fx = ax;
    }
    if (g.handle.includes('n')) {
      fy = ay - newHeight;
    } else {
      fy = ay;
    }

    finalBBox = { x: fx, y: fy, width: newWidth, height: newHeight };

    // Scale each object within the new bbox
    const resizeMap = new Map<string, Rect>();
    for (const [id, startRect] of g.startRects) {
      if (!presentIds.has(id)) continue;
      const newRect = scaleWithin(startRect, g.bboxStart, finalBBox);
      resizeMap.set(id, newRect);
    }

    if (resizeMap.size > 0) {
      resizeObjects(doc, resizeMap);
    }
  }, []);

  const cleanup = useCallback((keepLast: boolean) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.raf != null) cancelAnimationFrame(g.raf);

    if (keepLast) {
      // Apply the last position
      if (g.type === 'move') applyMoveFrame();
      if (g.type === 'resize') applyResizeFrame();
    }

    gestureRef.current = null;
    setIsDragging(false);
    optsRef.current.onGestureEnd?.();
  }, [applyMoveFrame, applyResizeFrame]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;

    if (!g.moved) {
      const dist = Math.hypot(e.clientX - g.startClientX, e.clientY - g.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      setIsDragging(true);
      optsRef.current.onGestureStart?.();

      if (g.type === 'move') {
        // Bring to front at the start of actual movement
        const ids = Array.from(g.startRects.keys());
        bringObjectsToFront(optsRef.current.doc, ids);
      }
    }

    g.latestClientX = e.clientX;
    g.latestClientY = e.clientY;

    if (g.raf === null) {
      if (g.type === 'move') {
        g.raf = requestAnimationFrame(applyMoveFrame);
      } else {
        g.raf = requestAnimationFrame(applyResizeFrame);
      }
    }
  }, [applyMoveFrame, applyResizeFrame]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;

    if (g.moved) {
      // Land exactly under the pointer
      g.latestClientX = e.clientX;
      g.latestClientY = e.clientY;
      if (g.raf != null) cancelAnimationFrame(g.raf);
      if (g.type === 'move') applyMoveFrame();
      else applyResizeFrame();
    }

    cleanup(false);
    removeWindowListeners();
  }, [applyMoveFrame, applyResizeFrame, cleanup]);

  const onPointerCancel = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    cleanup(true);
    removeWindowListeners();
  }, [cleanup]);

  const implRef = useRef({ onPointerMove, onPointerUp, onPointerCancel });
  implRef.current = { onPointerMove, onPointerUp, onPointerCancel };

  const winMove = useCallback((e: PointerEvent) => implRef.current.onPointerMove(e), []);
  const winUp = useCallback((e: PointerEvent) => implRef.current.onPointerUp(e), []);
  const winCancel = useCallback((e: PointerEvent) => implRef.current.onPointerCancel(), []);

  function attachWindow() {
    window.addEventListener('pointermove', winMove);
    window.addEventListener('pointerup', winUp);
    window.addEventListener('pointercancel', winCancel);
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', winMove);
    window.removeEventListener('pointerup', winUp);
    window.removeEventListener('pointercancel', winCancel);
  }

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    const { selection, canEdit, snapshot, camera } = optsRef.current;
    e.stopPropagation();

    if (!canEdit) return;

    // Shift+click toggles (multi-select) rather than starting a drag
    if (e.shiftKey) {
      selection.toggle(id);
      return;
    }

    // If the object is not in the selection, select only it
    if (!selection.ids.has(id)) {
      selection.click(id);
    }

    // Record start rects for all selected objects (including the one just selected)
    const selectedIds = selection.ids.has(id) ? selection.ids : new Set([id]);
    const startRects = new Map<string, { x: number; y: number }>();
    for (const sid of selectedIds) {
      const obj = snapshot.find((o) => o.id === sid);
      if (obj) startRects.set(sid, { x: obj.x, y: obj.y });
    }
    // If snapshot hasn't updated yet for the newly selected item, read from the id
    if (!startRects.has(id)) {
      const obj = snapshot.find((o) => o.id === id);
      if (obj) startRects.set(id, { x: obj.x, y: obj.y });
      else startRects.set(id, { x: 0, y: 0 });
    }

    gestureRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorld: screenToWorld(camera, { x: e.clientX, y: e.clientY }),
      zoom: camera.zoom || 1,
      startRects,
      moved: false,
      raf: null,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
    };

    attachWindow();
  }, [attachWindow]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    const { selection, snapshot, canEdit, camera } = optsRef.current;
    e.stopPropagation();

    if (!canEdit) return;
    if (selection.ids.size === 0) return;

    // Check if any selected type is resizable
    const selectedObjects = snapshot.filter((o) => selection.ids.has(o.id));
    const anyResizable = selectedObjects.some((o) => getObjectType(o.type)?.resizable);
    if (!anyResizable) return;

    // Check aspect lock: any type is aspectLocked or shift is held
    const aspectLocked = e.shiftKey || selectedObjects.some((o) => getObjectType(o.type)?.aspectLocked);

    const rects = selectedObjects.map(objectBounds);
    const bbox = unionRects(rects);
    if (!bbox) return;

    const startRects = new Map<string, Rect>();
    for (const obj of selectedObjects) {
      startRects.set(obj.id, objectBounds(obj));
    }

    gestureRef.current = {
      type: 'resize',
      pointerId: e.pointerId,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: camera.zoom || 1,
      bboxStart: bbox,
      startRects,
      aspectLocked,
      moved: false,
      raf: null,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
    };

    attachWindow();
  }, [attachWindow]);

  return { onObjectPointerDown, onHandlePointerDown, isDragging };
}
