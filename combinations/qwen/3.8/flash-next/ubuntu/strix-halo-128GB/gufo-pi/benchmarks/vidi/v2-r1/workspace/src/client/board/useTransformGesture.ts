import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type Point,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
} from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export interface UseTransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface UseTransformGestureResult {
  onObjectPointerDown(e: ReactPointerEvent | PointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /** True while a move or resize gesture is actively in progress. */
  isDragging: boolean;
}

type GesturePhase = 'idle' | 'pressed' | 'moving' | 'resizing';

interface GestureState {
  phase: GesturePhase;
  pointerId: number;
  startX: number;
  startY: number;
  /** Start screen position (client coords) for threshold detection. */
  startClientX: number;
  startClientY: number;
  /** Start rects for each selected object. */
  startRects: Map<string, Rect>;
  /** The bounding box at gesture start (for resize). */
  startBounds: Rect | null;
  /** Which handle is being dragged. */
  handle: Handle | null;
  /** Whether aspect is locked. */
  aspectLocked: boolean;
  /** Zoom at gesture start. */
  zoom: number;
  /** rAF handle. */
  frame: number | null;
  /** Pending delta. */
  pendingDx: number;
  pendingDy: number;
}

/**
 * Generic transform gesture: group move and handle resize.
 * Works identically for all object types (sel.all_types).
 */
export function useTransformGesture(opts: UseTransformGestureOpts): UseTransformGestureResult {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const [isDragging, setIsDragging] = useState(false);
  const stateRef = useRef<GestureState | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent | PointerEvent, id: string) => {
      if (!canEditRef.current) return;

      // If the object is not selected, select only it
      if (!selectionRef.current.ids.has(id)) {
        selectionRef.current.click(id);
      }

      const startClientX = (e as any).clientX as number;
      const startClientY = (e as any).clientY as number;

      stateRef.current = {
        phase: 'pressed',
        pointerId: (e as any).pointerId as number,
        startX: 0,
        startY: 0,
        startClientX,
        startClientY,
        startRects: new Map(),
        startBounds: null,
        handle: null,
        aspectLocked: false,
        zoom: cameraRef.current.zoom || 1,
        frame: null,
        pendingDx: 0,
        pendingDy: 0,
      };

      // Attach move/up handlers to the window
      const onMove = (moveEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== moveEvent.pointerId) return;

        const dx = moveEvent.clientX - state.startClientX;
        const dy = moveEvent.clientY - state.startClientY;

        if (state.phase === 'pressed') {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          // Threshold crossed: start moving
          state.phase = 'moving';
          setIsDragging(true);
          // Record start rects for all selected objects
          const snap = snapshotRef.current;
          const ids = selectionRef.current.ids;
          state.startRects.clear();
          for (const objId of ids) {
            const obj = snap.find((o) => o.id === objId);
            if (obj) state.startRects.set(objId, objectBounds(obj));
          }
          onGestureStartRef.current?.();
          // Bring to front
          bringObjectsToFront(doc, [...ids]);
        }

        if (state.phase === 'moving') {
          state.pendingDx = dx;
          state.pendingDy = dy;
          if (state.frame === null) {
            state.frame = requestFrame(() => {
              const s = stateRef.current;
              if (!s || s.phase !== 'moving') return;
              s.frame = null;
              applyMove(s, doc, selectionRef.current, snapshotRef.current);
            });
          }
        }
      };

      const onUp = (upEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== upEvent.pointerId) return;
        cleanup();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== cancelEvent.pointerId) return;
        cleanup();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      const cleanup = () => {
        const state = stateRef.current;
        if (state) {
          if (state.frame !== null) {
            cancelFrame(state.frame);
            state.frame = null;
          }
          // Apply any pending move
          if (state.phase === 'moving') {
            applyMove(state, doc, selectionRef.current, snapshotRef.current);
          }
          if (state.phase === 'moving' || state.phase === 'resizing') {
            onGestureEndRef.current?.();
          }
        }
        stateRef.current = null;
        setIsDragging(false);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [doc],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: Handle) => {
      if (!canEditRef.current) return;
      e.stopPropagation();

      const ids = selectionRef.current.ids;
      const snap = snapshotRef.current;

      // Check if any selected type is resizable
      let anyResizable = false;
      let anyAspectLocked = false;
      const rects: Rect[] = [];
      const minSizes: number[] = [];

      for (const objId of ids) {
        const obj = snap.find((o) => o.id === objId);
        if (!obj) continue;
        const spec = getObjectType(obj.type);
        if (spec?.resizable) anyResizable = true;
        if (spec?.aspectLocked) anyAspectLocked = true;
        rects.push(objectBounds(obj));
        minSizes.push(spec?.minSize ?? 0);
      }

      if (!anyResizable) return;

      const startBounds = unionRects(rects);
      if (!startBounds) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const aspectLocked = anyAspectLocked || e.shiftKey;

      const startRects = new Map<string, Rect>();
      for (const objId of ids) {
        const obj = snap.find((o) => o.id === objId);
        if (obj) startRects.set(objId, objectBounds(obj));
      }

      stateRef.current = {
        phase: 'pressed',
        pointerId: e.pointerId,
        startX: 0,
        startY: 0,
        startClientX,
        startClientY,
        startRects,
        startBounds,
        handle,
        aspectLocked,
        zoom: cameraRef.current.zoom || 1,
        frame: null,
        pendingDx: 0,
        pendingDy: 0,
      };

      onGestureStartRef.current?.();

      const onMove = (moveEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== moveEvent.pointerId) return;
        if (state.phase === 'pressed') {
          const dx = moveEvent.clientX - state.startClientX;
          const dy = moveEvent.clientY - state.startClientY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          state.phase = 'resizing';
          setIsDragging(true);
        }
        if (state.phase !== 'resizing') return;

        state.pendingDx = moveEvent.clientX - state.startClientX;
        state.pendingDy = moveEvent.clientY - state.startClientY;

        if (state.frame === null) {
          state.frame = requestFrame(() => {
            const s = stateRef.current;
            if (!s || s.phase !== 'resizing') return;
            s.frame = null;
            applyResize(s, doc, selectionRef.current, snapshotRef.current);
          });
        }
      };

      const onUp = (upEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== upEvent.pointerId) return;
        cleanup();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.pointerId !== cancelEvent.pointerId) return;
        cleanup();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      const cleanup = () => {
        const state = stateRef.current;
        if (state) {
          if (state.frame !== null) {
            cancelFrame(state.frame);
            state.frame = null;
          }
          if (state.phase === 'resizing') {
            applyResize(state, doc, selectionRef.current, snapshotRef.current);
          }
          if (state.phase === 'moving' || state.phase === 'resizing') {
            onGestureEndRef.current?.();
          }
        }
        stateRef.current = null;
        setIsDragging(false);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [doc],
  );

  return { onObjectPointerDown, onHandlePointerDown, isDragging };
}

function applyMove(
  state: GestureState,
  doc: Y.Doc,
  _selection: SelectionApi,
  snapshot: readonly ObjectSnapshot[],
): void {
  const positions = new Map<string, Point>();
  const dx = state.pendingDx / state.zoom;
  const dy = state.pendingDy / state.zoom;

  for (const [id, startRect] of state.startRects) {
    // Skip objects that no longer exist
    if (!snapshot.some((o) => o.id === id)) continue;
    positions.set(id, { x: startRect.x + dx, y: startRect.y + dy });
  }

  if (positions.size > 0) {
    moveObjects(doc, positions);
  }
}

function applyResize(
  state: GestureState,
  doc: Y.Doc,
  _selection: SelectionApi,
  snapshot: readonly ObjectSnapshot[],
): void {
  if (state.handle === null || state.startBounds === null) return;

  const dx = state.pendingDx / state.zoom;
  const dy = state.pendingDy / state.zoom;

  // Compute the new bounding box
  const newBounds = resizeRect(state.startBounds, state.handle, { x: dx, y: dy }, state.aspectLocked);

  // Compute scale factors
  const sx = state.startBounds.width > 0 ? newBounds.width / state.startBounds.width : 1;
  const sy = state.startBounds.height > 0 ? newBounds.height / state.startBounds.height : 1;

  // Collect rects and min sizes for clamping
  const rects: Rect[] = [];
  const minSizes: number[] = [];
  const objMap = new Map<string, Rect>();

  for (const [id, startRect] of state.startRects) {
    if (!snapshot.some((o) => o.id === id)) continue;
    rects.push(startRect);
    objMap.set(id, startRect);
    const obj = snapshot.find((o) => o.id === id);
    const spec = obj ? getObjectType(obj.type) : undefined;
    minSizes.push(spec?.minSize ?? 0);
  }

  if (rects.length === 0) return;

  // Clamp the scale
  const clamped = clampScale({ x: sx, y: sy }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

  // Compute the actual new bounding box from clamped scale
  const actualBounds: Rect = {
    x: newBounds.x,
    y: newBounds.y,
    width: state.startBounds.width * clamped.x,
    height: state.startBounds.height * clamped.y,
  };

  // Adjust position based on handle direction (anchor stays fixed)
  const handle = state.handle;
  if (handle.includes('w')) {
    actualBounds.x = state.startBounds.x + state.startBounds.width - actualBounds.width;
  }
  if (handle.includes('n')) {
    actualBounds.y = state.startBounds.y + state.startBounds.height - actualBounds.height;
  }

  // Scale each object within the bounding box
  const resizeMap = new Map<string, Rect>();
  for (const [id, startRect] of state.startRects) {
    if (!objMap.has(id)) continue;
    const scaled = scaleWithin(startRect, state.startBounds, actualBounds);
    resizeMap.set(id, scaled);
  }

  if (resizeMap.size > 0) {
    resizeObjects(doc, resizeMap);
  }
}

// ---- animation frame scheduling (with a fallback for bare jsdom) ----

const HAS_ANIMATION_FRAME =
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

function requestFrame(callback: () => void): number {
  if (HAS_ANIMATION_FRAME) return window.requestAnimationFrame(() => callback());
  return window.setTimeout(callback, 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (HAS_ANIMATION_FRAME) window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle as unknown as number);
}
