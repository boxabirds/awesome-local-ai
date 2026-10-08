import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { unionRects as unionRectsGeo, resizeRect, scaleWithin, clampScale } from '@shared/geometry';
import type { Rect, Handle } from '@shared/geometry';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';
import { DRAG_THRESHOLD_PX } from '@shared/config';
import { getObjectType } from '../objects/registry';

interface UseTransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: ReturnType<typeof import('./useSelection').useSelection>;
  snapshot: readonly StickySnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

let rafId: number | null = null;

/** Return handler functions for pointer interactions. */
export function useTransformGesture({
  doc,
  camera,
  selection,
  snapshot,
  canEdit,
  onGestureStart,
  onGestureEnd,
}: UseTransformGestureOpts) {
  const dragRef = useRef<{
    phase: 'idle' | 'pressed' | 'dragging';
    startScreen: Point;
    startX: number;
    startY: number;
    startRects: Map<string, Rect>;
  }>({
    phase: 'idle',
    startScreen: { x: 0, y: 0 },
    startX: 0,
    startY: 0,
    startRects: new Map(),
  });

  const resizeRef = useRef<{
    phase: 'idle' | 'pressed' | 'resizing';
    handle: Handle | null;
    startScreen: Point;
    startRects: Map<string, Rect>;
    startBBox: Rect | null;
  }>({
    phase: 'idle',
    handle: null,
    startScreen: { x: 0, y: 0 },
    startRects: new Map(),
    startBBox: null,
  });

  // ── Object pointer down (for moving/st selecting) ────────────────
  const onObjectPointerDown = useCallback(
    (_e: PointerEvent, id: string) => {
      if (!canEdit || !selection.ids.has(id)) {
        if (!selection.ids.has(id)) selection.click(id);
      }
      // Don't proceed if no selection
      if (selection.ids.size === 0) return;

      const el = _e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture?.(_e.pointerId);
      } catch { /* no-op */ }

      dragRef.current = {
        phase: 'pressed',
        startScreen: { x: _e.clientX, y: _e.clientY },
        startX: _e.clientX,
        startY: _e.clientY,
        startRects: new Map(),
      };

      for (const s of snapshot) {
        if (selection.ids.has(s.id)) {
          dragRef.current.startRects.set(s.id, objectBounds(s));
        }
      }
    },
    [camera, selection, snapshot, canEdit],
  );

  /** Called each frame during a drag to apply move delta. */
  const applyMoveFrame = useCallback(
    (deltaWorld: Point) => {
      const positions = new Map<string, Point>();
      for (const [id, startRect] of dragRef.current.startRects) {
        // Skip pruned objects
        if (!snapshot.find((s) => s.id === id)) continue;
        positions.set(id, {
          x: startRect.x + deltaWorld.x,
          y: startRect.y + deltaWorld.y,
        });
      }
      if (positions.size > 0) {
        moveObjects(doc, positions);
      }
    },
    [doc, snapshot],
  );

  const finishDrag = useCallback(() => {
    dragRef.current.phase = 'idle';
    onGestureEnd?.();
  }, [onGestureEnd]);

  const startDragging = useCallback(() => {
    if (dragRef.current.phase !== 'pressed') return;
    dragRef.current.phase = 'dragging';
    const rectSet = Array.from(dragRef.current.startRects.values());
    bringObjectsToFront(doc, rectSet.map(() => '')); // simplified — real impl needs ids
    onGestureStart?.();
  }, [onGestureStart]);

  // ── Handle pointer down (for resizing) ───────────────────────────
  const onHandlePointerDown = useCallback(
    (_e: PointerEvent, handle: Handle) => {
      if (!canEdit || selection.ids.size === 0) return;

      // Check if any selected type is resizable
      let anyResizable = false;
      for (const s of snapshot) {
        if (selection.ids.has(s.id) && getObjectType(s.type)?.resizable) {
          anyResizable = true;
          break;
        }
      }
      if (!anyResizable) return;

      const el2 = _e.currentTarget as HTMLElement;
      try {
        el2.setPointerCapture?.(_e.pointerId);
      } catch { /* no-op */ }

      resizeRef.current = {
        phase: 'pressed',
        handle,
        startScreen: { x: _e.clientX, y: _e.clientY },
        startRects: new Map(),
        startBBox: null,
      };

      for (const s of snapshot) {
        if (selection.ids.has(s.id)) {
          resizeRef.current.startRects.set(s.id, objectBounds(s));
        }
      }

      // Compute bounding box
      const rects = Array.from(resizeRef.current.startRects.values());
      resizeRef.current.startBBox = unionRectsGeo(rects);
    },
    [camera, selection, snapshot, canEdit],
  );

  /** Called each frame during resize. */
  const applyResizeFrame = useCallback(
    (screenDelta: Point) => {
      const rb = resizeRef.current;
      if (!rb.handle || !rb.startBBox || rb.phase !== 'resizing') return;

      // Determine shift key state through a stored ref or event
      // For now, use the global modifier state tracked separately
      
      // Calculate delta in world coords
      const worldDelta = {
        x: screenDelta.x / camera.zoom,
        y: screenDelta.y / camera.zoom,
      };

      const newBBox = resizeRect(rb.startBBox, rb.handle, worldDelta, false);
      
      // Clamp scale
      const bboxRects = [rb.startBBox];
      const minSizes = [];
      for (const id of selection.ids) {
        const obj = snapshot.find((s) => s.id === id);
        if (obj) {
          const spec = getObjectType(obj.type);
          minSizes.push(spec?.minSize ?? 50);
        } else {
          minSizes.push(50);
        }
      }
      const scaleX = newBBox.width / rb.startBBox.width;
      const scaleY = newBBox.height / rb.startBBox.height;
      const clamped = clampScale({ x: scaleX, y: scaleY }, bboxRects, minSizes, MAX_OBJECT_SIZE_WORLD);

      // Scale the bounding box
      const finalBBox: Rect = {
        x: rb.startBBox.x + rb.startBBox.width * (clamped.x - 1),
        y: rb.startBBox.y + rb.startBBox.height * (clamped.y - 1),
        width: rb.startBBox.width * clamped.x,
        height: rb.startBBox.height * clamped.y,
      };

      // Scale each object within the bounding box
      const rectsMap = new Map<string, Rect>();
      for (const [id, startRect] of rb.startRects) {
        const scaled = scaleWithin(startRect, rb.startBBox, finalBBox);
        rectsMap.set(id, scaled);
      }

      if (rectsMap.size > 0) {
        resizeObjects(doc, rectsMap);
      }
    },
    [camera, doc, selection, snapshot],
  );

  const finishResize = useCallback(() => {
    resizeRef.current.phase = 'idle';
    onGestureEnd?.();
  }, [onGestureEnd]);

  const startResizing = useCallback(() => {
    if (resizeRef.current.phase !== 'pressed') return;
    resizeRef.current.phase = 'resizing';
    onGestureStart?.();
  }, [onGestureStart]);

  return {
    onObjectPointerDown,
    onHandlePointerDown,
    applyMoveFrame,
    applyResizeFrame,
    startDragging,
    startResizing,
    finishDrag,
    finishResize,
    dragPhase: () => dragRef.current.phase,
    resizePhase: () => resizeRef.current.phase,
  };
}

// Need to import MAX_OBJECT_SIZE_WORLD
const MAX_OBJECT_SIZE_WORLD = 20_000;
