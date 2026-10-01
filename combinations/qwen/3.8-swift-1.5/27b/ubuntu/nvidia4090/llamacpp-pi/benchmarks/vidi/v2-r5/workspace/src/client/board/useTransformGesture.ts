// src/client/board/useTransformGesture.ts
// Generic transform gesture: group move and bounding-box resize handles.

import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import type { Camera, Point } from '../canvas/camera';
import { unionRects, resizeRect, clampScale, scaleWithin, type Rect, type Handle } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

export function useTransformGesture(opts: TransformGestureOpts) {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const rafRef = useRef<number>(0);
  const lastDeltaRef = useRef<Point | null>(null);

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (!canEdit) return;
    if (selection.editingId) return;

    e.stopPropagation();

    // Shift-click: toggle selection
    if (e.shiftKey) {
      selection.toggle(id);
      return; // Don't start a drag on shift-click
    }

    // If not selected, select only this object
    if (!selection.ids.has(id)) {
      selection.click(id);
    }

    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let startRects: Map<string, Rect> | null = null;

    el.setPointerCapture(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!started) {
        if (dist < DRAG_THRESHOLD_PX) return;

        // Start moving: record start rects of all selected objects
        startRects = new Map<string, Rect>();
        for (const sid of selection.ids) {
          const obj = snapshot.find(o => o.id === sid);
          if (obj) startRects.set(sid, objectBounds(obj));
        }
        started = true;

        onGestureStart?.();
        bringObjectsToFront(doc, [...selection.ids]);
      }

      if (started && startRects) {
        const worldDx = (ev.clientX - startX) / cameraRef.current.zoom;
        const worldDy = (ev.clientY - startY) / cameraRef.current.zoom;

        lastDeltaRef.current = { x: worldDx, y: worldDy };

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const delta = lastDeltaRef.current;
            if (!delta || !startRects) return;

            const positions = new Map<string, Point>();
            for (const [sid, startRect] of startRects) {
              positions.set(sid, { x: startRect.x + delta.x, y: startRect.y + delta.y });
            }
            moveObjects(doc, positions);
          });
        }
      }
    };

    const finish = (_ev: PointerEvent) => {
      if (started) {
        onGestureEnd?.();
      }
      cleanup();
    };

    const cleanup = () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('lostpointercapture', finish);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      lastDeltaRef.current = null;
    };

    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
  }, [canEdit, selection, snapshot, doc, onGestureStart, onGestureEnd]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (!canEdit) return;
    if (selection.ids.size === 0) return;

    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    // Check if any selected type is resizable
    let anyResizable = false;
    let anyAspectLocked = false;
    const startRects = new Map<string, Rect>();
    for (const id of selection.ids) {
      const obj = snapshot.find(o => o.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec?.resizable) anyResizable = true;
      if (spec?.aspectLocked) anyAspectLocked = true;
      startRects.set(id, objectBounds(obj));
    }

    if (!anyResizable) return;

    const bbox = unionRects([...startRects.values()]);
    if (!bbox) return;

    onGestureStart?.();

    const startX = e.clientX;
    const startY = e.clientY;

    const handleMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / cameraRef.current.zoom;
      const dy = (ev.clientY - startY) / cameraRef.current.zoom;
      const delta: Point = { x: dx, y: dy };

      const aspectLocked = anyAspectLocked || ev.shiftKey;
      const newBBox = resizeRect(bbox, handle, delta, aspectLocked);

      // Compute scale factors
      const sx = bbox.width > 0 ? newBBox.width / bbox.width : 1;
      const sy = bbox.height > 0 ? newBBox.height / bbox.height : 1;

      // Clamp scale
      const rects = [...startRects.values()];
      const minSizes: number[] = [];
      for (const id of selection.ids) {
        const obj = snapshot.find(o => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        minSizes.push(spec?.minSize ?? 50);
      }
      const clamped = clampScale({ sx, sy }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

      // Apply clamped scale to compute new bbox
      const clampedBBox: Rect = {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width * clamped.sx,
        height: bbox.height * clamped.sy,
      };

      // For edge/corner handles, adjust the position based on the handle
      let finalBBox = clampedBBox;
      const hasN = handle.includes('n');
      const hasW = handle.includes('w');
      if (hasW) {
        finalBBox = { ...finalBBox, x: bbox.x + bbox.width - finalBBox.width };
      }
      if (hasN) {
        finalBBox = { ...finalBBox, y: bbox.y + bbox.height - finalBBox.height };
      }

      // Scale each object within the new bbox
      const newRects = new Map<string, Rect>();
      for (const [id, childRect] of startRects) {
        const scaled = scaleWithin(childRect, bbox, finalBBox);
        newRects.set(id, scaled);
      }

      resizeObjects(doc, newRects);
    };

    const finish = () => {
      onGestureEnd?.();
      cleanup();
    };

    const cleanup = () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('lostpointercapture', finish);
    };

    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
  }, [canEdit, selection, snapshot, doc, onGestureStart, onGestureEnd]);

  return { onObjectPointerDown, onHandlePointerDown };
}
