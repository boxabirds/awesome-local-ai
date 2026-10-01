import { useRef, useCallback } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';

import type { Rect, Handle } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import {
  objectBounds,
  moveObject,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed, type TextSnapshot } from '../../shared/objects/text';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}) {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;
  const rafRef = useRef<number>(0);

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!canEdit) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      // If not selected, select only this object
      if (!selection.ids.has(id)) {
        selection.click(id);
      }

      const startScreenX = e.clientX;
      const startScreenY = e.clientY;

      // Capture the current selection ids (after potential click above)
      const selectedIds = new Set(selection.ids.has(id) ? selection.ids : [id]);

      let startRects: Map<string, Rect> | null = null;
      let isMoving = false;
      let pendingDx = 0;
      let pendingDy = 0;

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startScreenX;
        const dy = ev.clientY - startScreenY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isMoving && dist < DRAG_THRESHOLD_PX) return;

        if (!isMoving) {
          // Threshold crossed: start moving
          isMoving = true;
          startRects = new Map<string, Rect>();
          for (const obj of snapshot) {
            if (selectedIds.has(obj.id)) {
              startRects.set(obj.id, objectBounds(obj));
            }
          }
          onGestureStart?.();
          bringObjectsToFront(doc, [...selectedIds]);
        }

        pendingDx = dx / camera.zoom;
        pendingDy = dy / camera.zoom;

        if (rafRef.current === 0 && startRects) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            if (!startRects) return;
            const positions = new Map<string, Point>();
            for (const [oid, startRect] of startRects) {
              positions.set(oid, {
                x: startRect.x + pendingDx,
                y: startRect.y + pendingDy,
              });
            }
            moveObjects(doc, positions);
          });
        }
      };

      const handleUp = () => {
        if (isMoving) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
          onGestureEnd?.();
        }
        cleanup();
      };

      const handleCancel = () => {
        if (isMoving) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
          onGestureEnd?.();
        }
        cleanup();
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
    },
    [canEdit, camera, selection, snapshot, doc, onGestureStart, onGestureEnd],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      if (!canEdit) return;
      e.stopPropagation();
      e.preventDefault();

      // Check if any selected type is resizable
      const selectedObjs = snapshot.filter((o) => selection.ids.has(o.id));
      const anyResizable = selectedObjs.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.resizable ?? false;
      });
      if (!anyResizable) return;

      // Compute the bounding box of the selection
      const bounds = selectedObjs.map((o) => objectBounds(o));
      const startBox = unionRects(bounds);
      if (!startBox) return;

      const startRects = new Map<string, Rect>();
      for (const obj of selectedObjs) {
        startRects.set(obj.id, objectBounds(obj));
      }

      const startScreenX = e.clientX;
      const startScreenY = e.clientY;

      // Story 9: a single text object with a horizontal handle is a
      // fixed-width drag (setTextWidthFixed); the height re-wraps via the
      // object's local-change observer. Font size never changes via handles.
      const singleText =
        selectedObjs.length === 1 &&
        selectedObjs[0].type === 'text' &&
        (handle === 'e' || handle === 'w')
          ? selectedObjs[0]
          : null;

      // Determine if aspect is locked
      const anyAspectLocked = selectedObjs.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.aspectLocked ?? false;
      });

      const handleMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startScreenX) / camera.zoom;
        const dy = (ev.clientY - startScreenY) / camera.zoom;

        if (singleText) {
          const startRect = objectBounds(singleText);
          const newWidth = handle === 'e' ? startRect.width + dx : startRect.width - dx;
          setTextWidthFixed(doc, singleText.id, newWidth);
          if (handle === 'w') {
            // Keep the right edge fixed while the left handle moves
            const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, newWidth);
            moveObject(doc, singleText.id, startRect.x + (startRect.width - clamped), startRect.y);
          }
          return;
        }

        const aspectLocked = anyAspectLocked || ev.shiftKey;
        const newBox = resizeRect(startBox, handle, { x: dx, y: dy }, aspectLocked);

        // Compute scale
        const scaleX = newBox.width / startBox.width;
        const scaleY = newBox.height / startBox.height;

        // Clamp scale
        const minSizes = selectedObjs.map((o) => {
          const spec = getObjectType(o.type);
          return spec?.minSize ?? 0;
        });
        const rects = selectedObjs.map((o) => objectBounds(o));
        const clampedScale = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

        // Apply scaleWithin for each object
        const finalBox: Rect = {
          x: newBox.x,
          y: newBox.y,
          width: startBox.width * clampedScale.x,
          height: startBox.height * clampedScale.y,
        };

        // Story 9: in a group resize, text objects are repositioned
        // proportionally; only fixed-width text also scales its width (the
        // height re-wraps via the observer). Stickies resize as before.
        const rectsMap = new Map<string, Rect>();
        const textPositions = new Map<string, { x: number; y: number }>();
        const textWidths = new Map<string, number>();
        for (const [oid, startRect] of startRects) {
          const scaled = scaleWithin(startRect, startBox, finalBox);
          const obj = snapshot.find((o) => o.id === oid);
          if (obj?.type === 'text') {
            textPositions.set(oid, { x: scaled.x, y: scaled.y });
            if ((obj as TextSnapshot).widthMode === 'fixed') {
              textWidths.set(oid, scaled.width);
            }
          } else {
            rectsMap.set(oid, scaled);
          }
        }

        if (rafRef.current === 0) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            if (rectsMap.size > 0) resizeObjects(doc, rectsMap);
            if (textPositions.size > 0) moveObjects(doc, textPositions);
            for (const [oid, w] of textWidths) setTextWidthFixed(doc, oid, w);
          });
        }
      };

      const handleUp = () => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        onGestureEnd?.();
        cleanup();
      };

      const handleCancel = () => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        onGestureEnd?.();
        cleanup();
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
    },
    [canEdit, camera, selection, snapshot, doc, onGestureStart, onGestureEnd],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
