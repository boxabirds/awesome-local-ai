/**
 * useTransformGesture: handles group move and bounding-box resize via handles.
 * Absolute writes from gesture start to avoid drift with concurrent edits.
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { resizeRect, clampScale, scaleWithin, unionRects, type Handle, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import type { SelectionApi } from './useSelection';
import { getObjectType } from '../objects/registry';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureApi {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
}

interface GestureState {
  type: 'idle' | 'pressed' | 'moving' | 'resizing';
  startScreenX: number;
  startScreenY: number;
  dx: number;
  dy: number;
  startRects: Map<string, Rect>;
  bbox: Rect | null;
  handle: Handle | null;
  raf: number;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureApi {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const gRef = useRef<GestureState>({
    type: 'idle',
    startScreenX: 0,
    startScreenY: 0,
    dx: 0,
    dy: 0,
    startRects: new Map(),
    bbox: null,
    handle: null,
    raf: 0,
  });

  const cleanup = useCallback(() => {
    const g = gRef.current;
    if (g.raf) {
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    }
    g.type = 'idle';
    g.startRects.clear();
    g.bbox = null;
    g.handle = null;
    g.dx = 0;
    g.dy = 0;
  }, []);

  const applyMove = useCallback(() => {
    const g = gRef.current;
    g.raf = 0;
    if (g.type !== 'moving' || !canEditRef.current) return;

    const cam = cameraRef.current;
    const worldDx = g.dx / cam.zoom;
    const worldDy = g.dy / cam.zoom;

    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, rect] of g.startRects) {
      positions.set(id, { x: rect.x + worldDx, y: rect.y + worldDy });
    }
    moveObjects(doc, positions);
  }, [doc]);

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent, id: string) => {
      if (!canEditRef.current) return;
      e.stopPropagation();

      const sel = selectionRef.current;
      // If not selected, select only this object (sel.drag_unselected)
      if (!sel.ids.has(id)) {
        sel.click(id);
      }

      const snap = snapshotRef.current;

      // Record start rects of all currently selected ids
      const currentIds = sel.ids.has(id) ? sel.ids : new Set([id]);
      const startRects = new Map<string, Rect>();
      for (const obj of snap) {
        if (currentIds.has(obj.id)) {
          startRects.set(obj.id, objectBounds(obj));
        }
      }

      const g = gRef.current;
      g.type = 'pressed';
      g.startScreenX = e.clientX;
      g.startScreenY = e.clientY;
      g.dx = 0;
      g.dy = 0;
      g.startRects = startRects;
      g.bbox = unionRects([...startRects.values()]);
      g.handle = null;

      const moveHandler = (ev: PointerEvent) => {
        if (g.type === 'idle') return;
        const dx = ev.clientX - g.startScreenX;
        const dy = ev.clientY - g.startScreenY;

        if (g.type === 'pressed') {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
          g.type = 'moving';
          onGestureStartRef.current?.();
          // Bring all selected objects to front
          bringObjectsToFront(doc, [...currentIds]);
        }

        if (g.type === 'moving') {
          g.dx = dx;
          g.dy = dy;
          if (!g.raf) {
            g.raf = requestAnimationFrame(applyMove);
          }
        }
      };

      const upHandler = () => {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
        window.removeEventListener('pointercancel', cancelHandler);
        // Flush pending frame
        if (g.raf) {
          cancelAnimationFrame(g.raf);
          g.raf = 0;
          applyMove();
        }
        if (g.type === 'moving' || g.type === 'resizing') {
          onGestureEndRef.current?.();
        }
        cleanup();
      };

      const cancelHandler = () => {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
        window.removeEventListener('pointercancel', cancelHandler);
        if (g.raf) {
          cancelAnimationFrame(g.raf);
          g.raf = 0;
        }
        if (g.type === 'moving' || g.type === 'resizing') {
          onGestureEndRef.current?.();
        }
        cleanup();
      };

      window.addEventListener('pointermove', moveHandler);
      window.addEventListener('pointerup', upHandler);
      window.addEventListener('pointercancel', cancelHandler);
    },
    [doc, applyMove, cleanup],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: Handle) => {
      if (!canEditRef.current) return;
      e.stopPropagation();

      const sel = selectionRef.current;
      const snap = snapshotRef.current;

      // Check if any selected type is resizable
      const selectedObjects = snap.filter((o) => sel.ids.has(o.id));
      const anyResizable = selectedObjects.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.resizable ?? false;
      });
      if (!anyResizable) return;

      const rects = selectedObjects.map(objectBounds);
      const bbox = unionRects(rects);
      if (!bbox) return;

      // Determine aspect lock: true if any selected type has aspectLocked
      const aspectLocked = selectedObjects.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.aspectLocked ?? false;
      });

      // Determine if all selected are horizontal-only (text objects)
      const allHorizontal = selectedObjects.length > 0 && selectedObjects.every((o) => {
        const spec = getObjectType(o.type);
        return spec?.handles === 'horizontal';
      });

      const g = gRef.current;
      g.type = 'pressed';
      g.startScreenX = e.clientX;
      g.startScreenY = e.clientY;
      g.dx = 0;
      g.dy = 0;
      g.startRects = new Map(selectedObjects.map((o) => [o.id, objectBounds(o)]));
      g.bbox = bbox;
      g.handle = handle;

      const startBbox = bbox;

      const moveHandler = (ev: PointerEvent) => {
        if (g.type === 'idle' || !g.handle) return;
        const dx = ev.clientX - g.startScreenX;
        const dy = ev.clientY - g.startScreenY;

        if (g.type === 'pressed') {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
          g.type = 'resizing';
          onGestureStartRef.current?.();
        }

        if (g.type !== 'resizing') return;

        const cam = cameraRef.current;
        const worldDx = dx / cam.zoom;
        const worldDy = dy / cam.zoom;

        const useAspect = aspectLocked || ev.shiftKey;

        // Compute new bbox via resizeRect
        const newBbox = resizeRect(startBbox, g.handle, { x: worldDx, y: worldDy }, useAspect);

        // Compute scale factors
        let sx = startBbox.width !== 0 ? newBbox.width / startBbox.width : 1;
        let sy = startBbox.height !== 0 ? newBbox.height / startBbox.height : 1;

        // Clamp scale
        const objRects = [...g.startRects.values()];
        const minSizes: number[] = [];
        for (const obj of selectedObjects) {
          const spec = getObjectType(obj.type);
          minSizes.push(spec?.minSize ?? 1);
        }

        const clamped = clampScale({ x: sx, y: sy }, objRects, minSizes, MAX_OBJECT_SIZE_WORLD);
        sx = clamped.x;
        sy = clamped.y;

        // Reconstruct final bbox from clamped scale, anchored at the correct corner
        const finalBbox: Rect = {
          x: startBbox.x,
          y: startBbox.y,
          width: startBbox.width * sx,
          height: startBbox.height * sy,
        };

        // Adjust anchor: handles resize from the opposite corner
        if (g.handle.includes('w')) {
          finalBbox.x = startBbox.x + startBbox.width - finalBbox.width;
        }
        if (g.handle.includes('n')) {
          finalBbox.y = startBbox.y + startBbox.height - finalBbox.height;
        }

        // Apply scaleWithin per object
        const newRects = new Map<string, Rect>();
        for (const [id, r] of g.startRects) {
          newRects.set(id, scaleWithin(r, startBbox, finalBbox));
        }

        if (allHorizontal) {
          // For horizontal-only text objects, only change width via setTextWidthFixed
          for (const [id, r] of newRects) {
            setTextWidthFixed(doc, id, r.width);
          }
        } else {
          resizeObjects(doc, newRects);
        }
      };

      const upHandler = () => {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
        window.removeEventListener('pointercancel', cancelHandler);
        if (g.type === 'resizing') {
          onGestureEndRef.current?.();
        }
        cleanup();
      };

      const cancelHandler = () => {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
        window.removeEventListener('pointercancel', cancelHandler);
        if (g.type === 'resizing') {
          onGestureEndRef.current?.();
        }
        cleanup();
      };

      window.addEventListener('pointermove', moveHandler);
      window.addEventListener('pointerup', upHandler);
      window.addEventListener('pointercancel', cancelHandler);
    },
    [doc, cleanup],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
