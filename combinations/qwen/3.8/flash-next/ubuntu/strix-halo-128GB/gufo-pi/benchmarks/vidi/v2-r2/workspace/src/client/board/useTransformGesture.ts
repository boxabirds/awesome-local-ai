import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '@shared/board-model';
import { type Rect, type Handle, type Point, resizeRect, clampScale, scaleWithin, unionRects } from '@shared/geometry';
import { type Camera } from '@client/canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '@shared/config';
import { getObjectType } from '@client/objects/registry';
import { setTextWidthFixed } from '@shared/objects/text';
import type { SelectionApi } from './useSelection';

interface TransformGestureOpts {
  doc: Y.Doc;
  cameraRef: React.MutableRefObject<Camera>;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface MoveState {
  type: 'move';
  pointerId: number;
  startScreen: Point;
  startRects: Map<string, Rect>;
  started: boolean;
  draggedId: string;
}

interface ResizeState {
  type: 'resize';
  pointerId: number;
  handle: Handle;
  startScreen: Point;
  startRects: Map<string, Rect>;
  boundingBox: Rect;
  aspectLocked: boolean;
  minSizes: number[];
  rects: Rect[];
  started: boolean;
}

type GestureState = MoveState | ResizeState | null;

export function useTransformGesture(opts: TransformGestureOpts) {
  const { doc, cameraRef, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;

  const stateRef = useRef<GestureState>(null);
  const rafRef = useRef<number>(0);
  const pendingRef = useRef<(() => void) | null>(null);

  const scheduleFrame = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pendingRef.current) {
          pendingRef.current();
          pendingRef.current = null;
        }
      });
    }
  }, []);

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (e.button !== 0) return;
      if (!canEdit) return;

      // If not selected, select only this object
      if (!selection.ids.has(id)) {
        selection.click(id);
      }

      const startScreen: Point = { x: e.clientX, y: e.clientY };

      stateRef.current = {
        type: 'move',
        pointerId: e.pointerId,
        startScreen,
        startRects: new Map(),
        started: false,
        draggedId: id,
      };

      const onMove = (me: globalThis.PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.type !== 'move') return;
        if (me.pointerId !== state.pointerId) return;

        const dx = me.clientX - state.startScreen.x;
        const dy = me.clientY - state.startScreen.y;

        if (!state.started) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < DRAG_THRESHOLD_PX) return;
          // Start the gesture
          state.started = true;
          // Record start rects for all selected objects
          // Use current selection plus draggedId to handle async state update
          const currentIds = new Set(selection.ids);
          currentIds.add(state.draggedId);
          const snapById = new Map(snapshot.map((o) => [o.id, o]));
          for (const selId of currentIds) {
            const obj = snapById.get(selId);
            if (obj) {
              state.startRects.set(selId, objectBounds(obj));
            }
          }
          // Bring to front
          bringObjectsToFront(doc, [...currentIds]);
          onGestureStart?.();
        }

        // Calculate delta in world units
        const worldDx = dx / cameraRef.current.zoom;
        const worldDy = dy / cameraRef.current.zoom;

        scheduleFrame(() => {
          const positions = new Map<string, Point>();
          for (const [objId, rect] of state.startRects) {
            positions.set(objId, { x: rect.x + worldDx, y: rect.y + worldDy });
          }
          moveObjects(doc, positions);
        });
      };

      const onUp = () => {
        cleanup();
        if (stateRef.current?.type === 'move' && stateRef.current.started) {
          onGestureEnd?.();
        }
        stateRef.current = null;
      };

      const onCancel = () => {
        cleanup();
        if (stateRef.current?.type === 'move' && stateRef.current.started) {
          onGestureEnd?.();
        }
        stateRef.current = null;
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [doc, cameraRef, selection, snapshot, canEdit, onGestureStart, onGestureEnd, scheduleFrame],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      if (!canEdit) return;

      // Check if any selected type is resizable
      const selectedObjs = snapshot.filter((o) => selection.ids.has(o.id));
      if (selectedObjs.length === 0) return;

      const anyResizable = selectedObjs.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.resizable;
      });
      if (!anyResizable) return;

      const rects = selectedObjs.map((o) => objectBounds(o));
      const boundingBox = unionRects(rects);
      if (!boundingBox) return;

      // Check if all selected objects use horizontal-only handles (text objects)
      const allHorizontal = selectedObjs.every((o) => {
        const spec = getObjectType(o.type);
        return spec?.handles === 'horizontal';
      });

      // Determine aspect lock: any type with aspectLocked, or Shift held
      const specAspectLocked = selectedObjs.some((o) => {
        const spec = getObjectType(o.type);
        return spec?.aspectLocked;
      });
      const aspectLocked = specAspectLocked || e.shiftKey;

      const minSizes = selectedObjs.map((o) => {
        const spec = getObjectType(o.type);
        return spec?.minSize ?? 0;
      });

      const startScreen: Point = { x: e.clientX, y: e.clientY };
      const startRects = new Map<string, Rect>();
      for (let i = 0; i < selectedObjs.length; i++) {
        startRects.set(selectedObjs[i].id, rects[i]);
      }

      stateRef.current = {
        type: 'resize',
        pointerId: e.pointerId,
        handle,
        startScreen,
        startRects,
        boundingBox,
        aspectLocked,
        minSizes,
        rects,
        started: false,
      };

      onGestureStart?.();

      const onMove = (me: globalThis.PointerEvent) => {
        const state = stateRef.current;
        if (!state || state.type !== 'resize') return;
        if (me.pointerId !== state.pointerId) return;

        const dx = (me.clientX - state.startScreen.x) / cameraRef.current.zoom;
        const dy = (me.clientY - state.startScreen.y) / cameraRef.current.zoom;

        scheduleFrame(() => {
          if (allHorizontal) {
            // Horizontal-only resize for text objects
            const newWidth = Math.max(TEXT_MIN_WIDTH_WORLD, state.boundingBox.width + dx);
            const newX = state.handle === 'w'
              ? state.boundingBox.x + state.boundingBox.width - newWidth
              : state.boundingBox.x;

            for (const [objId, startRect] of state.startRects) {
              // For text objects, use setTextWidthFixed
              const result = setTextWidthFixed(doc, objId, newWidth);
              if (!result) {
                // Fallback: update x directly if needed
                const obj = doc.getMap<Y.Map<unknown>>('objects').get(objId);
                if (obj && state.handle === 'w') {
                  const xRatio = startRect.width !== 0 ? (startRect.x - state.boundingBox.x) / state.boundingBox.width : 0;
                  obj.set('x', newX + xRatio * newWidth);
                }
              }
            }
            return;
          }

          // Standard resize for mixed selections (non-text)
          // Compute new bounding box
          const newBox = resizeRect(state.boundingBox, state.handle, { x: dx, y: dy }, state.aspectLocked);

          // Compute scale factors
          const scaleX = state.boundingBox.width !== 0 ? newBox.width / state.boundingBox.width : 1;
          const scaleY = state.boundingBox.height !== 0 ? newBox.height / state.boundingBox.height : 1;

          // Clamp scale so no object violates its min/max
          const clampedScale = clampScale(
            { x: scaleX, y: scaleY },
            state.rects,
            state.minSizes,
            MAX_OBJECT_SIZE_WORLD,
          );

          // Compute the final bounding box after clamping
          const finalBox: Rect = {
            x: state.boundingBox.x,
            y: state.boundingBox.y,
            width: state.boundingBox.width * clampedScale.x,
            height: state.boundingBox.height * clampedScale.y,
          };

          // Adjust final box position for handles that move the anchor
          if (state.handle === 'w' || state.handle === 'nw' || state.handle === 'sw') {
            finalBox.x = state.boundingBox.x + state.boundingBox.width - finalBox.width;
          }
          if (state.handle === 'n' || state.handle === 'nw' || state.handle === 'ne') {
            finalBox.y = state.boundingBox.y + state.boundingBox.height - finalBox.height;
          }

          // Scale each object within the new bounding box
          const resizeMap = new Map<string, Rect>();
          for (const [objId, startRect] of state.startRects) {
            const scaled = scaleWithin(startRect, state.boundingBox, finalBox);
            resizeMap.set(objId, scaled);
          }
          resizeObjects(doc, resizeMap);
        });
      };

      const onUp = () => {
        cleanup();
        onGestureEnd?.();
        stateRef.current = null;
      };

      const onCancel = () => {
        cleanup();
        onGestureEnd?.();
        stateRef.current = null;
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [doc, cameraRef, selection, snapshot, canEdit, onGestureStart, onGestureEnd, scheduleFrame],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
