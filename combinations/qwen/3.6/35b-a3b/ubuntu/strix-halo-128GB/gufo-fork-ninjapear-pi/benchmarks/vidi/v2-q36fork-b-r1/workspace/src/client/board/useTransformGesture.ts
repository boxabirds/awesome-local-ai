import { useCallback, useRef, useEffect, useState } from 'react';
import type { Camera, Point } from '@/client/canvas/camera';
import { screenToWorld, worldToScreen, panBy } from '@/client/canvas/camera';
import { moveObjects, resizeObjects, bringObjectsToFront } from '@/shared/board-model';
import { unionRects, resizeRect, clampScale, scaleWithin } from '@/shared/geometry';
import type { ObjectSnapshot, Handle } from '@/client/objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '@/shared/config';
import { getObjectType } from '@/client/objects/registry';

type GestureState =
  | { phase: 'idle' }
  | { phase: 'pressed'; startScreen: Point; startWorld: Point; objectId: string }
  | { phase: 'moving'; startScreen: Point; startRects: Map<string, Point>; camera: Camera }
  | { phase: 'resizing'; handle: Handle; startScreen: Point; startRects: Map<string, any>; bbox: Rect; camera: Camera };

interface Rect { x: number; y: number; width: number; height: number; }

interface UseTransformGestureOptions {
  doc: import('yjs').Doc;
  camera: Camera;
  selectedIds: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  isEditing: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/**
 * Handles group move and bounding-box resize gestures.
 * Returns handlers for object pointerdown and handle pointerdown.
 */
export function useTransformGesture({
  doc,
  camera,
  selectedIds,
  snapshot,
  canEdit,
  isEditing,
  onGestureStart,
  onGestureEnd,
}: UseTransformGestureOptions): {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  setViewportRef(ref: HTMLDivElement | null): void;
} {
  const [gestureState, setGestureState] = useState<GestureState>({ phase: 'idle' });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const moveEventRef = useRef<{ x: number; y: number } | null>(null);

  // Set viewport ref for lost pointer capture
  const setViewportRef = useCallback((ref: HTMLDivElement | null) => {
    viewportRef.current = ref;
  }, []);

  // Helper: get bounds of an object
  function getBBox(obj: ObjectSnapshot): Rect {
    return {
      x: obj.x,
      y: obj.y,
      width: (obj.width as number) ?? 200,
      height: (obj.height as number) ?? 200,
    };
  }

  // Capture pointer and begin tracking
  const capturePointer = useCallback((e: React.PointerEvent, objId?: string) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* already captured */ }
    const point: Point = { x: e.clientX, y: e.clientY };
    if (objId) {
      const snap = snapshot.find(s => s.id === objId);
      setGestureState({
        phase: 'pressed',
        startScreen: point,
        startWorld: snap ? { x: Number(snap.x), y: Number(snap.y) } : { x: 0, y: 0 },
        objectId: objId,
      });
    } else {
      setGestureState({
        phase: 'pressed',
        startScreen: point,
        startWorld: screenToWorld(camera, point),
        objectId: '__group__',
      });
    }
  }, [camera, snapshot]);

  // --- Resize gesture handler ---
  useEffect(() => {
    if (gestureState.phase !== 'resizing') return;
    
    let active = true;
    const gs = gestureState;
    
    const applyResize = () => {
      if (!active || !canEdit || isEditing || !moveEventRef.current) return;

      const startX = gs.startScreen.x;
      const startY = gs.startScreen.y;
      const curX = moveEventRef.current.x;
      const curY = moveEventRef.current.y;
      
      const deltaScreen: Point = { x: curX - startX, y: curY - startY };
      
      // Aspect lock
      let aspectLocked = false;
      for (const snap of snapshot) {
        if (selectedIds.has(snap.id)) {
          const spec = getObjectType(snap.type);
          if (spec?.aspectLocked) { aspectLocked = true; break; }
        }
      }
      
      const rawBbox = resizeRect(gs.bbox, gs.handle, deltaScreen, aspectLocked);
      
      // Compute scale factors
      const scaleX = Math.max(0.01, Math.min(MAX_OBJECT_SIZE_WORLD / gs.bbox.width, 100));
      const scaleY = Math.max(0.01, Math.min(MAX_OBJECT_SIZE_WORLD / gs.bbox.height, 100));
      const sx = Math.min(scaleX, scaleY);
      const sy = Math.min(scaleX, scaleY);
      
      // Apply scaled positions to each object
      const rects = new Map<string, Rect>();
      for (const snap of snapshot) {
        if (!selectedIds.has(snap.id)) continue;
        const origBounds = getBBox(snap);
        const ox = (origBounds.x - gs.bbox.x) / gs.bbox.width;
        const oy = (origBounds.y - gs.bbox.y) / gs.bbox.height;
        
        const newX = rawBbox.x + ox * (rawBbox.width - sx * gs.bbox.width);
        const newY = rawBbox.y + oy * (rawBbox.height - sy * gs.bbox.height);
        const newW = origBounds.width * sx;
        const newH = origBounds.height * sy;
        
        rects.set(snap.id, { x: newX, y: newY, width: newW, height: newH });
      }

      if (rects.size > 0) {
        resizeObjects(doc, rects);
      }
      
      requestAnimationFrame(applyResize);
    };
    
    requestAnimationFrame(applyResize);
    
    return () => { active = false; };
  }, [gestureState, canEdit, isEditing, doc, selectedIds, snapshot]);

  // --- Move gesture handler ---
  useEffect(() => {
    if (gestureState.phase !== 'moving') return;
    
    // Add window-level listeners for pointer events during drag
    const handleWindowPointerMove = (e: MouseEvent) => {
      if (!canEdit || isEditing || !moveEventRef.current) return;
      
      const gs = gestureState;
      const deltaX = e.clientX - gs.startScreen.x;
      const deltaY = e.clientY - gs.startScreen.y;
      const worldDx = deltaX / camera.zoom;
      const worldDy = deltaY / camera.zoom;
      
      const positions = new Map<string, Point>();
      for (const [id, startPos] of gs.startRects) {
        const nx = startPos.x + worldDx;
        const ny = startPos.y + worldDy;
        if (isFinite(nx) && isFinite(ny)) {
          positions.set(id, { x: nx, y: ny });
        }
      }
      
      if (positions.size > 0) {
        moveObjects(doc, positions);
      }
    };
    
    window.addEventListener('pointermove', handleWindowPointerMove);
    return () => window.removeEventListener('pointermove', handleWindowPointerMove);
  }, [gestureState, canEdit, isEditing, doc, camera]);

  // Release handler — cancel resize or end move
  useEffect(() => {
    if (gestureState.phase !== 'moving') return;
    
    const handleWindowPointerUp = () => {
      onGestureEnd?.();
      setGestureState({ phase: 'idle' });
      moveEventRef.current = null;
    };
    
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [gestureState, onGestureEnd]);

  // When pressed transitions → detect threshold → start moving
  useEffect(() => {
    if (gestureState.phase !== 'pressed') return;
    
    const handleGlobalPointerMove = (e: MouseEvent) => {
      const dx = e.clientX - gestureState.startScreen.x;
      const dy = e.clientY - gestureState.startScreen.y;
      
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX) {
        window.removeEventListener('mousemove', handleGlobalPointerMove);
        
        // Call onGestureStart when actual movement begins
        onGestureStart?.();
        
        const startRects = new Map<string, Point>();
        if (gestureState.objectId === '__group__') {
          // Collect all selected objects
          for (const snap of snapshot) {
            if (selectedIds.has(snap.id)) {
              startRects.set(snap.id, { x: snap.x, y: snap.y });
            }
          }
          
          if (startRects.size > 0) {
            moveEventRef.current = { x: e.clientX, y: e.clientY };
            setGestureState({
              phase: 'moving',
              startScreen: gestureState.startScreen,
              startRects,
              camera,
            });
          }
        }
        // Single object: let StickyNote handle its own drag via the model
      }
    };
    
    window.addEventListener('mousemove', handleGlobalPointerMove);
    return () => window.removeEventListener('mousemove', handleGlobalPointerMove);
  }, [gestureState, selectedIds, snapshot, camera, onGestureStart]);

  // Track current pointer position for resize
  useEffect(() => {
    if (gestureState.phase === 'resizing' || gestureState.phase === 'moving') {
      const handleMove = (e: MouseEvent) => {
        moveEventRef.current = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener('mousemove', handleMove);
      return () => window.removeEventListener('mousemove', handleMove);
    }
  }, [gestureState.phase]);

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!canEdit && !selectedIds.has(id)) return;
      if (isEditing) return;
      
      e.stopPropagation();
      capturePointer(e, id);
    },
    [canEdit, selectedIds, isEditing, capturePointer],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (!canEdit) return;
      
      // Call onGestureStart for resize too
      onGestureStart?.();
      
      // Compute bounding box at gesture start
      const rects = Array.from(snapshot).filter(s => selectedIds.has(s.id)).map(getBBox);
      const bbox = unionRects(rects);
      if (!bbox) return;
      
      moveEventRef.current = { x: e.clientX, y: e.clientY };
      const startRects = new Map(snapshot.filter(s => selectedIds.has(s.id)).map(s => [s.id, getBBox(s)]));
      
      setGestureState({
        phase: 'resizing',
        handle,
        startScreen: { x: e.clientX, y: e.clientY },
        startRects,
        bbox,
        camera,
      });
      
      const vp = viewportRef.current;
      if (vp) {
        try {
          vp.setPointerCapture(e.pointerId);
        } catch { /* already captured */ }
      }
    },
    [canEdit, selectedIds, snapshot, camera, onGestureStart],
  );

  return {
    onObjectPointerDown,
    onHandlePointerDown,
    setViewportRef,
  };
}
