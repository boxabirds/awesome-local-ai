import * as React from 'react';
import type { Doc } from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import type { Handle } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '../../shared/board-model';
import { screenToWorld } from '../canvas/camera';
import { unionRects, resizeRect as resizeRectGeo, scaleWithin, clampScale as clampScaleGeo } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

interface UseTransformGestureOptions {
  doc: Doc;
  camera: Camera;
  selection: {
    ids: ReadonlySet<string>;
    click(id: string): void;
    setMany(ids: string[], additive: boolean): void;
    clear(): void;
    startEdit(id: string): void;
    endEdit(next: 'selected' | 'unselected'): void;
  };
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

let nextGestureId = 0;

export function useTransformGesture(opts: UseTransformGestureOptions): {
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
} {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  // Refs for fast access in pointer event handlers
  const docRef = React.useRef(doc);
  const cameraRef = React.useRef(camera);
  const selectionRef = React.useRef(selection);
  const snapshotRef = React.useRef(snapshot);
  const canEditRef = React.useRef(canEdit);
  const onStartRef = React.useRef(onGestureStart);
  const onEndRef = React.useRef(onGestureEnd);

  React.useEffect(() => { docRef.current = doc; }, [doc]);
  React.useEffect(() => { cameraRef.current = camera; }, [camera]);
  React.useEffect(() => { selectionRef.current = selection; }, [selection]);
  React.useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  React.useEffect(() => { canEditRef.current = canEdit; }, [canEdit]);
  React.useEffect(() => { onStartRef.current = onGestureStart; }, [onGestureStart]);
  React.useEffect(() => { onEndRef.current = onGestureEnd; }, [onGestureEnd]);

  // Check if any selected object type is resizable
  const hasResizableType = React.useCallback((): boolean => {
    for (const id of selection.ids) {
      const obj = snapshotRef.current.find((s) => s.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec?.resizable) return true;
    }
    return false;
  }, [selection.ids]);

  // Check if any selected type is aspectLocked or Shift held
  const aspectLockedRef = React.useRef(false);

  const computeStartState = React.useCallback((): {
    positions: Map<string, { x: number; y: number }>;
    sizes: Map<string, { width: number; height: number }>;
    boundingBox?: { x: number; y: number; width: number; height: number };
  } => {
    const positions = new Map<string, { x: number; y: number }>();
    const sizes = new Map<string, { width: number; height: number }>();
    
    for (const id of selection.ids) {
      const obj = snapshotRef.current.find((s) => s.id === id);
      if (!obj) continue;
      positions.set(id, { x: obj.x, y: obj.y });
      sizes.set(id, { width: obj.width ?? 200, height: obj.height ?? 200 });
    }

    const rects = [...positions.entries()].map(([id]) => ({
      x: positions.get(id)!.x,
      y: positions.get(id)!.y,
      width: sizes.get(id)!.width,
      height: sizes.get(id)!.height,
    }));
    
    const bb = unionRects(rects);

    return { positions, sizes, boundingBox: bb || undefined };
  }, [selection.ids]);

  const onObjectPointerDown = React.useCallback(
    (e: PointerEvent, objId: string) => {
      if (!canEditRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const gestureId = ++nextGestureId;
      
      // If not already selected, select only this object
      if (!selection.ids.has(objId)) {
        selection.click(objId);
      }

      try {
        const el = (e.target as HTMLElement).closest('.sticky-note') || e.currentTarget as Element;
        if (el && 'setPointerCapture' in el) {
          (el as HTMLElement).setPointerCapture(e.pointerId);
        }
      } catch { /* ignore */ }

      const startX = e.clientX;
      const startY = e.clientY;
      let phase: 'pressed' | 'moving' = 'pressed';
      let startPosMap: Map<string, { x: number; y: number }> | null = null;
      let dragDeltaWorld = { x: 0, y: 0 };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        
        if (phase === 'pressed') {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= DRAG_THRESHOLD_PX) {
            phase = 'moving';
            
            // Compute start positions now
            const state = computeStartState();
            startPosMap = state.positions;
            
            // Bring selection to front (multiple objects)
            if (startPosMap.size > 1) {
              bringObjectsToFront(docRef.current, [...startPosMap.keys()]);
            }
            
            onStartRef.current?.();
          } else {
            return;
          }
        }

        if (phase === 'moving' && startPosMap) {
          const zoomFactor = 1 / cameraRef.current.zoom;
          const deltaWorld = {
            x: dx * zoomFactor,
            y: dy * zoomFactor,
          };
          
          const positions = new Map<string, { x: number; y: number }>();
          for (const [pid, start] of startPosMap) {
            // Check object still exists
            const obj = snapshotRef.current.find((s) => s.id === pid);
            if (!obj) continue;
            positions.set(pid, { x: start.x + deltaWorld.x, y: start.y + deltaWorld.y });
          }
          
          if (positions.size > 0) {
            moveObjects(docRef.current, positions);
          }
        }
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (phase === 'moving') {
          onEndRef.current?.();
        }
      };

      const onCancel = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        // pointercancel: still close the capture window as one step
        if (phase === 'moving') {
          onEndRef.current?.();
        }
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    [selection.ids, computeStartState],
  );

  const onHandlePointerDown = React.useCallback(
    (e: PointerEvent, handle: Handle) => {
      if (!canEditRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      if (!hasResizableType()) return;

      const gestureId = ++nextGestureId;
      const startX = e.clientX;
      const startY = e.clientY;
      let phase: 'pressed' | 'resizing' = 'pressed';

      // Compute start BB
      const rects = [...selection.ids].map((id) => {
        const obj = snapshotRef.current.find((s) => s.id === id);
        if (!obj) return null;
        return {
          x: obj.x,
          y: obj.y,
          width: obj.width ?? 200,
          height: obj.height ?? 200,
        };
      }).filter(Boolean) as { x: number; y: number; width: number; height: number }[];

      const startBB = unionRects(rects);
      if (!startBB || startBB.width <= 0 || startBB.height <= 0) return;

      // Determine aspect lock
      let anyAspectLocked = false;
      for (const id of selection.ids) {
        const obj = snapshotRef.current.find((s) => s.id === id);
        if (!obj) continue;
        const spec = getObjectType(obj.type);
        if (spec?.aspectLocked) { anyAspectLocked = true; break; }
      }

      try {
        const el = e.target as HTMLElement;
        if (el && 'setPointerCapture' in el) {
          (el as HTMLElement).setPointerCapture(e.pointerId);
        }
      } catch { /* ignore */ }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;

        const dxScreen = ev.clientX - startX;
        const dyScreen = ev.clientY - startY;

        if (phase === 'pressed') {
          const dist = Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen);
          if (dist >= DRAG_THRESHOLD_PX) {
            phase = 'resizing';
            onStartRef.current?.();
          } else {
            return;
          }
        }

        if (phase === 'resizing') {
          const zoomFactor = 1 / cameraRef.current.zoom;
          const deltaWorld = {
            x: dxScreen * zoomFactor,
            y: dyScreen * zoomFactor,
          };

          const newBB = resizeRectGeo(startBB, handle, deltaWorld, anyAspectLocked || ev.shiftKey);
          
          // Clamp scale
          const rList = [];
          const mList = [];
          for (const id of selection.ids) {
            const obj = snapshotRef.current.find((s) => s.id === id);
            if (!obj) continue;
            rList.push({ x: obj.x, y: obj.y, width: obj.width ?? 200, height: obj.height ?? 200 });
            const spec = getObjectType(obj.type);
            mList.push(spec ? spec.minSize : 50);
          }
          
          const scaleX = newBB.width / startBB.width;
          const scaleY = newBB.height / startBB.height;
          const clamped = clampScaleGeo(
            { x: Math.abs(scaleX), y: Math.abs(scaleY) },
            rList,
            mList,
            20_000, // MAX_OBJECT_SIZE_WORLD
          );

          // Apply final scale
          const finalBB = {
            x: startBB.x + (startBB.width * (1 - clamped.x)) / 2,
            y: startBB.y + (startBB.height * (1 - clamped.y)) / 2,
            width: startBB.width * clamped.x,
            height: startBB.height * clamped.y,
          };

          // Scale each object
          const rectMap = new Map<string, { x: number; y: number; width: number; height: number }>();
          for (const id of selection.ids) {
            const obj = snapshotRef.current.find((s) => s.id === id);
            if (!obj) continue;
            const oldRect = {
              x: obj.x, y: obj.y,
              width: obj.width ?? 200, height: obj.height ?? 200,
            };
            const newRect = scaleWithin(oldRect, startBB, finalBB);
            rectMap.set(id, newRect);
          }

          if (rectMap.size > 0) {
            resizeObjects(docRef.current, rectMap);
          }
        }
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (phase === 'resizing') {
          onEndRef.current?.();
        }
      };

      const onCancel = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        // pointercancel: still close the capture window as one step
        if (phase === 'resizing') {
          onEndRef.current?.();
        }
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    [selection.ids, hasResizableType],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
