/**
 * useTransformGesture: generic group move and bounding-box resize handles.
 *
 * - onObjectPointerDown: handles select + drag (group move)
 * - onHandlePointerDown: handles resize from selection bounding box handles
 */

import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type React from 'react';
import type { Camera } from '../canvas/camera';
import type { UseSelectionResult } from './useSelection';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
} from '../../shared/board-model';
import type { Handle, Rect } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
} from '../../shared/config';

export interface UseTransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface UseTransformGestureResult {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

interface MoveState {
  type: 'move';
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  startRects: Map<string, Rect>;
  moved: boolean;
  frame: number | null;
}

interface ResizeState {
  type: 'resize';
  pointerId: number;
  handle: Handle;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  startRect: Rect;
  startBounds: Map<string, Rect>;
  boundingBox: Rect;
  aspectLocked: boolean;
  minSizes: number[];
  rects: Rect[];
  moved: boolean;
  frame: number | null;
}

type GestureState = MoveState | ResizeState | null;

export function useTransformGesture(opts: UseTransformGestureOptions): UseTransformGestureResult {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const gestureRef = useRef<GestureState>(null);
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
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;

    e.stopPropagation();

    // If object is not selected, select only it
    const sel = selectionRef.current;
    if (!sel.ids.has(id)) {
      sel.click(id);
    }

    // Start recording a potential move gesture
    const snapshotNow = snapshotRef.current;
    const startRects = new Map<string, Rect>();
    for (const obj of snapshotNow) {
      if (sel.ids.has(obj.id) || obj.id === id) {
        startRects.set(obj.id, objectBounds(obj));
      }
    }

    gestureRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: e.clientX,
      originY: e.clientY,
      startRects,
      moved: false,
      frame: null,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture best-effort
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const state = gestureRef.current;
      if (!state || state.type !== 'move' || state.pointerId !== moveEvent.pointerId) return;

      const distance = Math.hypot(moveEvent.clientX - state.originX, moveEvent.clientY - state.originY);
      if (!state.moved) {
        if (distance < DRAG_THRESHOLD_PX) return;
        // Gesture starts
        if (!canEditRef.current) return;
        state.moved = true;
        onGestureStartRef.current?.();
        // Bring to front
        const ids = [...state.startRects.keys()];
        bringObjectsToFront(doc, ids);
      }

      // Update position and schedule write
      state.startX = moveEvent.clientX;
      state.startY = moveEvent.clientY;
      scheduleWrite(state);
    };

    const handleUp = (upEvent: PointerEvent) => {
      const state = gestureRef.current;
      if (!state || state.pointerId !== upEvent.pointerId) return;

      if (state.type === 'move' && state.moved && state.frame !== null) {
        cancelAnimationFrame(state.frame);
        state.frame = null;
        doWrite(state);
      }
      if (state.moved) {
        onGestureEndRef.current?.();
      }
      gestureRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };

    const handleCancel = () => {
      const state = gestureRef.current;
      if (!state) return;
      if (state.type === 'move' && state.frame !== null) {
        cancelAnimationFrame(state.frame);
        state.frame = null;
        doWrite(state);
      }
      if (state.moved) {
        onGestureEndRef.current?.();
      }
      gestureRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  }, [doc]);

  const scheduleWrite = (state: MoveState): void => {
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      if (gestureRef.current === state) {
        doWrite(state);
      }
    });
  };

  const doWrite = (state: MoveState): void => {
    if (!canEditRef.current) return;
    const zoom = cameraRef.current.zoom || 1;
    const dx = (state.startX - state.originX) / zoom;
    const dy = (state.startY - state.originY) / zoom;

    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, rect] of state.startRects) {
      positions.set(id, { x: rect.x + dx, y: rect.y + dy });
    }
    moveObjects(doc, positions);
  };

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    e.stopPropagation();

    if (!canEditRef.current) return;

    const sel = selectionRef.current;
    const snapshotNow = snapshotRef.current;
    const selectedObjs = snapshotNow.filter((obj) => sel.ids.has(obj.id));
    if (selectedObjs.length === 0) return;

    // Check if any selected type is resizable
    let anyResizable = false;
    let aspectLocked = e.shiftKey;
    const minSizes: number[] = [];
    const rects: Rect[] = [];
    const startBounds = new Map<string, Rect>();

    for (const obj of selectedObjs) {
      const spec = getObjectType(obj.type);
      if (spec?.resizable) anyResizable = true;
      if (spec?.aspectLocked) aspectLocked = true;
      minSizes.push(spec?.minSize ?? 10);
      rects.push(objectBounds(obj));
      startBounds.set(obj.id, objectBounds(obj));
    }

    if (!anyResizable) return;

    const boundingBox = unionRects(rects);
    if (!boundingBox) return;

    const startRect = { ...boundingBox };

    gestureRef.current = {
      type: 'resize',
      pointerId: e.pointerId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      originX: e.clientX,
      originY: e.clientY,
      startRect,
      startBounds,
      boundingBox,
      aspectLocked,
      minSizes,
      rects,
      moved: false,
      frame: null,
    };

    onGestureStartRef.current?.();

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const state = gestureRef.current;
      if (!state || state.type !== 'resize' || state.pointerId !== moveEvent.pointerId) return;
      state.startX = moveEvent.clientX;
      state.startY = moveEvent.clientY;
      if (state.frame === null) {
        state.frame = requestAnimationFrame(() => {
          state.frame = null;
          if (gestureRef.current === state) doResize(state);
        });
      }
    };

    const handleUp = (upEvent: PointerEvent) => {
      const state = gestureRef.current;
      if (!state || state.pointerId !== upEvent.pointerId) return;
      if (state.type === 'resize' && state.frame !== null) {
        cancelAnimationFrame(state.frame);
        state.frame = null;
        doResize(state);
      }
      onGestureEndRef.current?.();
      gestureRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };

    const handleCancel = () => {
      const state = gestureRef.current;
      if (!state) return;
      if (state.type === 'resize' && state.frame !== null) {
        cancelAnimationFrame(state.frame);
        state.frame = null;
        doResize(state);
      }
      onGestureEndRef.current?.();
      gestureRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  }, [doc]);

  const doResize = (state: ResizeState): void => {
    if (!canEditRef.current) return;
    const zoom = cameraRef.current.zoom || 1;
    const dx = (state.startX - state.originX) / zoom;
    const dy = (state.startY - state.originY) / zoom;

    // Compute new bounding box
    const newBBox = resizeRect(state.startRect, state.handle, { x: dx, y: dy }, state.aspectLocked);

    // Compute scale factors
    let scaleX = state.startRect.width > 0 ? newBBox.width / state.startRect.width : 1;
    let scaleY = state.startRect.height > 0 ? newBBox.height / state.startRect.height : 1;

    // Clamp scale
    const clamped = clampScale(
      { x: scaleX, y: scaleY },
      state.rects,
      state.minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    scaleX = clamped.x;
    scaleY = clamped.y;

    // Compute the actual target bbox from the clamped scale
    const targetBBox: Rect = {
      x: state.startRect.x,
      y: state.startRect.y,
      width: state.startRect.width * scaleX,
      height: state.startRect.height * scaleY,
    };

    // Adjust position based on anchor for the handle
    if (state.handle.includes('w')) {
      targetBBox.x = state.startRect.x + state.startRect.width - targetBBox.width;
    }
    if (state.handle.includes('n')) {
      targetBBox.y = state.startRect.y + state.startRect.height - targetBBox.height;
    }

    // Scale each object within the bounding box
    const newRects = new Map<string, Rect>();
    for (const [id, startBounds] of state.startBounds) {
      newRects.set(id, scaleWithin(startBounds, state.boundingBox, targetBBox));
    }
    resizeObjects(doc, newRects);
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
