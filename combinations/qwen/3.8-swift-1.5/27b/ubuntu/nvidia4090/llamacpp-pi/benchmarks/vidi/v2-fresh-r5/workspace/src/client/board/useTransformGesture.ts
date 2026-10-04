import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import type { Rect, Handle } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';

interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: {
    ids: ReadonlySet<string>;
    click: (id: string) => void;
  };
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * Close the current undo capture window (story 8). Called before the
   * first local change of a gesture and when the gesture ends, so each
   * gesture is exactly one undo step.
   */
  boundary?: () => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

type GestureState =
  | { kind: 'idle' }
  | {
      kind: 'pressed';
      pointerId: number;
      startScreen: Point;
      objectId: string;
      isHandle: boolean;
      handle?: Handle;
    }
  | {
      kind: 'moving';
      pointerId: number;
      startScreen: Point;
      startRects: Map<string, Rect>;
      ids: string[];
    }
  | {
      kind: 'resizing';
      pointerId: number;
      startScreen: Point;
      startBounds: Rect;
      startRects: Map<string, Rect>;
      ids: string[];
      handle: Handle;
      aspectLocked: boolean;
    };

/**
 * Generic transform gesture: group move and bounding-box resize.
 */
export function useTransformGesture(opts: TransformGestureOpts) {
  const { doc, camera, selection, snapshot, canEdit } = opts;
  const stateRef = useRef<GestureState>({ kind: 'idle' });
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ type: 'move'; delta: Point } | { type: 'resize'; delta: Point } | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;

    const state = stateRef.current;
    if (state.kind === 'moving') {
      const positions = new Map<string, Point>();
      for (const [id, startRect] of state.startRects) {
        positions.set(id, { x: startRect.x + pending.delta.x, y: startRect.y + pending.delta.y });
      }
      moveObjects(doc, positions);
    } else if (state.kind === 'resizing') {
      const newBounds = resizeRect(
        state.startBounds,
        state.handle,
        pending.delta,
        state.aspectLocked,
      );

      // Compute scale and clamp
      const scaleX = state.startBounds.width > 0 ? newBounds.width / state.startBounds.width : 1;
      const scaleY = state.startBounds.height > 0 ? newBounds.height / state.startBounds.height : 1;

      const rects: Rect[] = [];
      const minSizes: number[] = [];
      for (const id of state.ids) {
        const startRect = state.startRects.get(id)!;
        rects.push(startRect);
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        minSizes.push(spec?.minSize ?? 50);
      }

      const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      const finalBounds: Rect = {
        x: state.startBounds.x,
        y: state.startBounds.y,
        width: state.startBounds.width * clamped.x,
        height: state.startBounds.height * clamped.y,
      };

      // Scale each object within the bounds
      const newRects = new Map<string, Rect>();
      for (const id of state.ids) {
        const startRect = state.startRects.get(id)!;
        const scaled = scaleWithin(startRect, state.startBounds, finalBounds);
        newRects.set(id, scaled);
      }
      resizeObjects(doc, newRects);
    }
  }, [doc, snapshot]);

  const scheduleFrame = useCallback(
    (pending: { type: 'move'; delta: Point } | { type: 'resize'; delta: Point }) => {
      pendingRef.current = pending;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          flush();
        });
      }
    },
    [flush],
  );

  const endGesture = useCallback(() => {
    // Flush any pending frame
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      flush();
    }
    stateRef.current = { kind: 'idle' };
    // Close the capture window so the next gesture starts a new undo step
    // even if it begins within the capture timeout.
    opts.boundary?.();
    opts.onGestureEnd?.();
  }, [flush, opts]);

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!canEdit) return;

      // Determine the set of ids to move. If the object is not yet selected,
      // it will be selected (via dispatch), but the closure's selection.ids
      // is stale – so we capture the intended ids here.
      const wasSelected = selection.ids.has(id);
      if (!wasSelected) {
        selection.click(id);
      }
      // The ids to move: the current selection if the object was already
      // selected, otherwise just this object.
      const moveIds: string[] = wasSelected ? Array.from(selection.ids) : [id];

      stateRef.current = {
        kind: 'pressed',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        objectId: id,
        isHandle: false,
      };

      const el = e.currentTarget as Element;
      el.setPointerCapture(e.pointerId);

      const onMove = (ev: Event) => {
        const pEv = ev as PointerEvent;
        const state = stateRef.current;
        if (pEv.pointerId !== e.pointerId) return;

        if (state.kind === 'pressed') {
          const dx = pEv.clientX - state.startScreen.x;
          const dy = pEv.clientY - state.startScreen.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < DRAG_THRESHOLD_PX) return;

          // Crossed threshold: start moving
          const ids = moveIds;
          const startRects = new Map<string, Rect>();
          for (const oid of ids) {
            const obj = snapshot.find((o) => o.id === oid);
            if (obj) startRects.set(oid, objectBounds(obj));
          }

          stateRef.current = {
            kind: 'moving',
            pointerId: pEv.pointerId,
            startScreen: state.startScreen,
            startRects,
            ids,
          };

          // New undo step for this gesture (story 8).
          opts.boundary?.();
          opts.onGestureStart?.();
          bringObjectsToFront(doc, ids);

          const worldDelta = { x: dx / camera.zoom, y: dy / camera.zoom };
          scheduleFrame({ type: 'move', delta: worldDelta });
        } else if (state.kind === 'moving') {
          const dx = pEv.clientX - state.startScreen.x;
          const dy = pEv.clientY - state.startScreen.y;
          const worldDelta = { x: dx / camera.zoom, y: dy / camera.zoom };
          scheduleFrame({ type: 'move', delta: worldDelta });
        }
      };

      const onUp = (ev: Event) => {
        const pEv = ev as PointerEvent;
        if (pEv.pointerId !== e.pointerId) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        const state = stateRef.current;
        if (state.kind === 'moving') {
          endGesture();
        } else {
          stateRef.current = { kind: 'idle' };
        }
      };

      const onCancel = (ev: Event) => {
        const pEv = ev as PointerEvent;
        if (pEv.pointerId !== e.pointerId) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        const state = stateRef.current;
        if (state.kind === 'moving') {
          endGesture();
        } else {
          stateRef.current = { kind: 'idle' };
        }
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onCancel);
    },
    [canEdit, selection, snapshot, doc, camera, opts, scheduleFrame, endGesture],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      if (!canEdit) return;

      const ids = Array.from(selection.ids);
      if (ids.length === 0) return;

      // Check if any selected type is resizable
      const startRects = new Map<string, Rect>();
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (obj) startRects.set(id, objectBounds(obj));
      }

      const rects = Array.from(startRects.values());
      const bounds = unionRects(rects);
      if (!bounds) return;

      // Check aspect lock: any selected type is aspectLocked OR Shift is held
      let aspectLocked = e.shiftKey;
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (spec?.aspectLocked) {
          aspectLocked = true;
          break;
        }
      }

      stateRef.current = {
        kind: 'resizing',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startBounds: bounds,
        startRects,
        ids,
        handle,
        aspectLocked,
      };

      const el = e.currentTarget as Element;
      el.setPointerCapture(e.pointerId);

      // New undo step for this gesture (story 8).
      opts.boundary?.();
      opts.onGestureStart?.();

      const onMove = (ev: Event) => {
        const pEv = ev as PointerEvent;
        const state = stateRef.current;
        if (state.kind !== 'resizing' || pEv.pointerId !== state.pointerId) return;

        const dx = pEv.clientX - state.startScreen.x;
        const dy = pEv.clientY - state.startScreen.y;
        const worldDelta = { x: dx / camera.zoom, y: dy / camera.zoom };
        scheduleFrame({ type: 'resize', delta: worldDelta });
      };

      const onUp = (ev: Event) => {
        const pEv = ev as PointerEvent;
        if (pEv.pointerId !== e.pointerId) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        endGesture();
      };

      const onCancel = (ev: Event) => {
        const pEv = ev as PointerEvent;
        if (pEv.pointerId !== e.pointerId) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        endGesture();
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onCancel);
    },
    [canEdit, selection, snapshot, camera, opts, scheduleFrame, endGesture],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
