import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { SelectionApi } from './useSelection';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_MIN_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
} from '../../shared/config';
import { unionRects, resizeRect, clampScale, scaleWithin } from '../../shared/geometry';
import type { Rect, Handle, Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { hitTestStroke } from '../../shared/objects/stroke';
import type { UndoController } from './undo';

/**
 * Transform gesture: group move and bounding-box resize.
 *
 * Only takes over when the story-7 behaviour differs from a single-note drag:
 *   - Shift+click on a note → toggle (no drag).
 *   - Pointerdown on an *already* selected note when 2+ are selected →
 *     group drag: all selected notes move together.
 *
 * For a single note (unselected or alone in the selection) it returns false
 * so StickyNote's own drag path runs. That keeps the story-2 tests valid
 * while adding the story-7 group behaviour on top.
 */
export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  /** Called after a resize gesture completes with affected object IDs. */
  onResizeComplete?(ids: readonly string[]): void;
  /** This person's undo history (story 8): a gesture is one undo step. */
  undo: UndoController;
}

export interface TransformGestureApi {
  onObjectPointerDown(e: PointerEvent, id: string): boolean;
  /**
   * A press on empty surface, given the world point under it. Returns true when
   * the gesture claims the press, which tells the viewport not to pan.
   */
  onSurfacePointerDown(e: PointerEvent, world: Point): boolean;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  mode: 'move' | 'resize';
  handle?: Handle;
  startRects: Map<string, Rect>;
  boundingBox: Rect;
  aspectLocked: boolean;
  moved: boolean;
}

export function useTransformGesture(
  optsRef: { current: TransformGestureOptions },
): TransformGestureApi {
  const gestureRef = useRef<GestureState | null>(null);
  const handlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  const cleanup = useCallback(() => {
    const h = handlersRef.current;
    if (h) {
      window.removeEventListener('pointermove', h.move);
      window.removeEventListener('pointerup', h.up);
      window.removeEventListener('pointercancel', h.cancel);
    }
    handlersRef.current = null;
    gestureRef.current = null;
  }, []);

  const startTracking = useCallback(() => {
    // Remove any stale listeners but KEEP the current gesture state. The
    // caller has already written `gestureRef.current` before invoking us.
    const h = handlersRef.current;
    if (h) {
      window.removeEventListener('pointermove', h.move);
      window.removeEventListener('pointerup', h.up);
      window.removeEventListener('pointercancel', h.cancel);
    }

    const onMove = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) {
        cleanup();
        return;
      }
      if (e.pointerId !== gesture.pointerId) return;
      if (e.buttons === 0) {
        cleanup();
        return;
      }

      const opts = optsRef.current;
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      const dist = Math.hypot(dx, dy);

      if (!gesture.moved) {
        if (dist < DRAG_THRESHOLD_PX) return;
        gesture.moved = true;
        opts.onGestureStart?.();
        // Start the gesture's capture group: the raise and every frame's
        // transform below land in one undo step (story 8).
        opts.undo.boundary();
        if (gesture.mode === 'move') {
          const ids = [...gesture.startRects.keys()];
          bringObjectsToFront(opts.doc, ids);
        }
      }

      const zoom = opts.camera.zoom > 0 ? opts.camera.zoom : 1;
      const worldDx = dx / zoom;
      const worldDy = dy / zoom;

      if (gesture.mode === 'move') {
        const positions = new Map<string, Point>();
        for (const [objId, startRect] of gesture.startRects) {
          positions.set(objId, {
            x: startRect.x + worldDx,
            y: startRect.y + worldDy,
          });
        }
        moveObjects(opts.doc, positions);
      } else if (gesture.mode === 'resize' && gesture.handle) {
        const newBB = resizeRect(
          gesture.boundingBox,
          gesture.handle,
          { x: worldDx, y: worldDy },
          gesture.aspectLocked,
        );

        const rects: Rect[] = [];
        const minSizes: number[] = [];
        for (const objId of gesture.startRects.keys()) {
          const obj = opts.snapshot.find((s) => s.id === objId);
          let min = STICKY_MIN_SIZE_WORLD;
          if (obj) {
            const spec = getObjectType(obj.type);
            if (spec) min = spec.minSize;
          }
          minSizes.push(min);
        }
        for (const r of gesture.startRects.values()) rects.push(r);

        let scaleX =
          gesture.boundingBox.width > 0 ? newBB.width / gesture.boundingBox.width : 1;
        let scaleY =
          gesture.boundingBox.height > 0 ? newBB.height / gesture.boundingBox.height : 1;

        if (gesture.aspectLocked) {
          const s = Math.max(scaleX, scaleY);
          scaleX = s;
          scaleY = s;
        }

        const clamped = clampScale(
          { x: scaleX, y: scaleY },
          rects,
          minSizes,
          MAX_OBJECT_SIZE_WORLD,
        );

        const clampedW = gesture.boundingBox.width * clamped.x;
        const clampedH = gesture.boundingBox.height * clamped.y;
        if (clampedW <= 0 || clampedH <= 0) return;

        let bbX = gesture.boundingBox.x;
        let bbY = gesture.boundingBox.y;
        if (gesture.handle.includes('w')) {
          bbX = gesture.boundingBox.x + gesture.boundingBox.width - clampedW;
        }
        if (gesture.handle.includes('n')) {
          bbY = gesture.boundingBox.y + gesture.boundingBox.height - clampedH;
        }
        const targetBox: Rect = { x: bbX, y: bbY, width: clampedW, height: clampedH };

        const rectsMap = new Map<string, Rect>();
        for (const [objId, startRect] of gesture.startRects) {
          const scaled = scaleWithin(startRect, gesture.boundingBox, targetBox);
          rectsMap.set(objId, scaled);
        }
        resizeObjects(opts.doc, rectsMap);
      }
    };

    const endGesture = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) {
        cleanup();
        return;
      }
      if (e.pointerId !== gesture.pointerId) return;
      if (gesture.moved) {
        // End the capture group, on a cancel too: a partial gesture is
        // still one step (story 8).
        optsRef.current.undo.boundary();
        if (gesture.mode === 'resize') {
          optsRef.current.onResizeComplete?.([...gesture.startRects.keys()]);
        }
        optsRef.current.onGestureEnd?.();
      }
      cleanup();
    };

    const onUp = (e: PointerEvent) => endGesture(e);
    const onCancel = (e: PointerEvent) => endGesture(e);

    handlersRef.current = { move: onMove, up: onUp, cancel: onCancel };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [cleanup, optsRef]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const buildGesture = (
    e: PointerEvent,
    mode: 'move' | 'resize',
    ids: readonly string[],
    aspectLocked: boolean,
    handle?: Handle,
  ): GestureState | null => {
    const snapshot = optsRef.current.snapshot;
    const startRects = new Map<string, Rect>();
    for (const objId of ids) {
      const obj = snapshot.find((s) => s.id === objId);
      if (!obj) continue;
      startRects.set(objId, objectBounds(obj));
    }
    if (startRects.size === 0) return null;
    const bb = unionRects([...startRects.values()]);
    if (!bb) return null;
    return {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      mode,
      handle,
      startRects,
      boundingBox: bb,
      aspectLocked,
      moved: false,
    };
  };

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string): boolean => {
      const opts = optsRef.current;
      if (!opts.canEdit) return false;

      if (e.shiftKey) {
        opts.selection.toggle(id);
        return true;
      }

      const count = opts.selection.ids.size;
      const already = opts.selection.has(id);
      if (already && count >= 2) {
        // Group drag.
        const ids = [...opts.selection.ids];
        const gesture = buildGesture(e, 'move', ids, false);
        if (!gesture) return false;
        gestureRef.current = gesture;
        startTracking();
        return true;
      }

      // Single-object drags fall through to StickyNote's own story-2 drag
      // machine, which writes `moveObject` per note and raises z per note.
      // Deliberate for now: it keeps story 2's behaviour and its tests intact.
      // It also means "generic transform" is not yet true -- a new object type
      // gets group drags but not single drags, and single drags never reach
      // bringObjectsToFront/moveObjects. Removing the fall-through is the
      // precondition for stories 9-12, not a task of its own.
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optsRef, startTracking],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle): void => {
      const opts = optsRef.current;
      if (!opts.canEdit) return;
      const snapshot = opts.snapshot;
      const selectedIds = [...opts.selection.ids];
      if (selectedIds.length === 0) return;

      let anyResizable = false;
      let aspectLocked = e.shiftKey;
      let horizontalOnly = true;
      for (const objId of selectedIds) {
        const obj = snapshot.find((s) => s.id === objId);
        if (!obj) continue;
        const spec = getObjectType(obj.type);
        if (spec) {
          if (spec.resizable) anyResizable = true;
          if (spec.aspectLocked) aspectLocked = true;
          if (spec.handles !== 'horizontal') horizontalOnly = false;
        } else {
          horizontalOnly = false;
        }
      }
      if (!anyResizable) return;

      // Horizontal-only mode: only allow e/w handles.
      if (horizontalOnly && handle !== 'e' && handle !== 'w') return;

      const gesture = buildGesture(e, 'resize', selectedIds, aspectLocked, handle);
      if (!gesture) return;
      gestureRef.current = gesture;
      startTracking();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optsRef, startTracking],
  );

  const onSurfacePointerDown = useCallback(
    (e: PointerEvent, world: Point): boolean => {
      const opts = optsRef.current;
      if (!opts.canEdit) return false;
      if (opts.selection.ids.size === 0) return false;
      const zoom = opts.camera.zoom > 0 ? opts.camera.zoom : 1;
      // Topmost first: ink under other ink is not the line you pressed.
      for (let index = opts.snapshot.length - 1; index >= 0; index -= 1) {
        const obj = opts.snapshot[index]!;
        if (obj.type !== 'stroke') continue;
        // Only a *selected* stroke is movable by its line. An unselected one is
        // still just board: pressing there pans, and letting go without travel
        // selects it, which is the two-step the story asks for.
        if (!opts.selection.has(obj.id)) continue;
        // Measured against the object's own origin, at the zoom it is seen at.
        if (
          !hitTestStroke(obj, { x: world.x - obj.x, y: world.y - obj.y }, zoom)
        ) {
          continue;
        }
        const gesture = buildGesture(e, 'move', [obj.id], false);
        if (!gesture) return false;
        gestureRef.current = gesture;
        startTracking();
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startTracking],
  );

  return { onObjectPointerDown, onSurfacePointerDown, onHandlePointerDown };
}