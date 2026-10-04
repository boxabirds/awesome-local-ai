import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import { resizeRect, clampScale, scaleWithin, unionRects, type Rect, type Point, type Handle } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { UseSelectionResult } from './useSelection';

type GestureState =
  | { phase: 'idle' }
  | { phase: 'pressed'; id: string; startScreen: Point; startWorld: Point }
  | { phase: 'moving'; id: string; startScreen: Point; startRects: Map<string, Rect>; startWorld: Point }
  | { phase: 'resizing'; handle: Handle; startScreen: Point; startBounds: Rect; startRects: Map<string, Rect> };

export interface UseTransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/**
 * Generic transform gesture: handles group move and bounding-box resize.
 */
export function useTransformGesture(opts: UseTransformGestureOpts) {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const stateRef = useRef<GestureState>({ phase: 'idle' });
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  // Keep refs current
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const flush = useCallback(() => {
    rafRef.current = null;
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  }, []);

  const schedule = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0) return;
      if (!canEditRef.current) return;

      e.stopPropagation();

      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch { /* jsdom */ }

      const screenPoint = { x: e.clientX, y: e.clientY };
      const worldPoint = screenToWorld(cameraRef.current, screenToViewport(e, el));

      // If not selected, select only this object
      if (!selectionRef.current.ids.has(id)) {
        selectionRef.current.click(id);
      }

      stateRef.current = {
        phase: 'pressed',
        id,
        startScreen: screenPoint,
        startWorld: worldPoint,
      };

      // Handle pointer move and up on the element
      const handleMove = (me: PointerEvent) => {
        const state = stateRef.current;
        if (state.phase !== 'pressed' && state.phase !== 'moving') return;

        const dx = me.clientX - state.startScreen.x;
        const dy = me.clientY - state.startScreen.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (state.phase === 'pressed') {
          if (distance < DRAG_THRESHOLD_PX) return;

          // Threshold crossed: start moving
          const selIds = selectionRef.current.ids;
          const startRects = new Map<string, Rect>();
          for (const obj of snapshotRef.current) {
            if (selIds.has(obj.id)) {
              startRects.set(obj.id, objectBounds(obj));
            }
          }

          stateRef.current = {
            phase: 'moving',
            id: state.id,
            startScreen: state.startScreen,
            startRects,
            startWorld: state.startWorld,
          };

          onGestureStart?.();
          bringObjectsToFront(doc, [...selIds]);
        }

        // Moving: compute absolute positions
        const worldDx = dx / cameraRef.current.zoom;
        const worldDy = dy / cameraRef.current.zoom;

        const positions = new Map<string, Point>();
        for (const [objId, startRect] of stateRef.current.phase === 'moving' ? (stateRef.current as Extract<GestureState, { phase: 'moving' }>).startRects : []) {
          positions.set(objId, {
            x: startRect.x + worldDx,
            y: startRect.y + worldDy,
          });
        }

        schedule(() => {
          moveObjects(doc, positions);
        });
      };

      const handleUp = (_ue: PointerEvent) => {
        cleanup();
        const state = stateRef.current;
        if (state.phase === 'moving') {
          onGestureEnd?.();
        }
        stateRef.current = { phase: 'idle' };

        // If it was just a click (no drag), the selection is already set
        // by the pointerdown handler
      };

      const handleCancel = () => {
        cleanup();
        if (stateRef.current.phase === 'moving') {
          onGestureEnd?.();
        }
        stateRef.current = { phase: 'idle' };
      };

      const cleanup = () => {
        el.removeEventListener('pointermove', handleMove);
        el.removeEventListener('pointerup', handleUp);
        el.removeEventListener('pointercancel', handleCancel);
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch { /* ignore */ }
      };

      el.addEventListener('pointermove', handleMove);
      el.addEventListener('pointerup', handleUp);
      el.addEventListener('pointercancel', handleCancel);
    },
    [doc, schedule, onGestureStart, onGestureEnd],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      if (e.button !== 0) return;
      if (!canEditRef.current) return;

      e.stopPropagation();
      e.preventDefault();

      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch { /* jsdom */ }

      const screenPoint = { x: e.clientX, y: e.clientY };
      const selIds = selectionRef.current.ids;
      const selectedObjs = snapshotRef.current.filter((o) => selIds.has(o.id));

      if (selectedObjs.length === 0) return;

      // Check if any is resizable
      const anyResizable = selectedObjs.some((o) => getObjectType(o.type)?.resizable);
      if (!anyResizable) return;

      const startBounds = unionRects(selectedObjs.map(objectBounds))!;
      const startRects = new Map<string, Rect>();
      for (const obj of selectedObjs) {
        startRects.set(obj.id, objectBounds(obj));
      }

      stateRef.current = {
        phase: 'resizing',
        handle,
        startScreen: screenPoint,
        startBounds,
        startRects,
      };

      onGestureStart?.();

      const handleMove = (me: PointerEvent) => {
        const state = stateRef.current;
        if (state.phase !== 'resizing') return;

        const dx = (me.clientX - state.startScreen.x) / cameraRef.current.zoom;
        const dy = (me.clientY - state.startScreen.y) / cameraRef.current.zoom;
        const delta: Point = { x: dx, y: dy };

        // Aspect lock: any selected type is aspectLocked, or Shift is held
        const anyAspectLocked = selectedObjs.some((o) => getObjectType(o.type)?.aspectLocked);
        const aspectLocked = anyAspectLocked || me.shiftKey;

        // Resize the bounding box
        const newBounds = resizeRect(state.startBounds, state.handle, delta, aspectLocked);

        // Compute scale
        const scaleX = newBounds.width / state.startBounds.width;
        const scaleY = newBounds.height / state.startBounds.height;

        // Clamp scale
        const rects = [...state.startRects.values()];
        const minSizes = selectedObjs.map((o) => getObjectType(o.type)?.minSize ?? 50);
        const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

        // Apply aspect lock to clamped scale if needed
        let finalScaleX = clamped.x;
        let finalScaleY = clamped.y;
        if (aspectLocked) {
          const uniform = Math.min(clamped.x, clamped.y);
          finalScaleX = uniform;
          finalScaleY = uniform;
        }

        // Compute the new bounds with clamped scale
        const clampedBounds: Rect = {
          x: newBounds.x,
          y: newBounds.y,
          width: state.startBounds.width * finalScaleX,
          height: state.startBounds.height * finalScaleY,
        };

        // Scale each object within the new bounds
        const newRects = new Map<string, Rect>();
        for (const [objId, objRect] of state.startRects) {
          newRects.set(objId, scaleWithin(objRect, state.startBounds, clampedBounds));
        }

        schedule(() => {
          resizeObjects(doc, newRects);
        });
      };

      const handleUp = () => {
        cleanup();
        if (stateRef.current.phase === 'resizing') {
          onGestureEnd?.();
        }
        stateRef.current = { phase: 'idle' };
      };

      const handleCancel = () => {
        cleanup();
        if (stateRef.current.phase === 'resizing') {
          onGestureEnd?.();
        }
        stateRef.current = { phase: 'idle' };
      };

      const cleanup = () => {
        el.removeEventListener('pointermove', handleMove);
        el.removeEventListener('pointerup', handleUp);
        el.removeEventListener('pointercancel', handleCancel);
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch { /* ignore */ }
      };

      el.addEventListener('pointermove', handleMove);
      el.addEventListener('pointerup', handleUp);
      el.addEventListener('pointercancel', handleCancel);
    },
    [doc, schedule, onGestureStart, onGestureEnd],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}

/** Convert a pointer event's client coords to viewport-relative coords. */
function screenToViewport(e: React.PointerEvent, el: HTMLElement): Point {
  // For the gesture, we use clientX/clientY directly as screen coordinates
  // The camera's screenToWorld expects viewport-relative coords
  const rect = el.closest('.board-viewport')?.getBoundingClientRect();
  return {
    x: e.clientX - (rect?.left ?? 0),
    y: e.clientY - (rect?.top ?? 0),
  };
}
