import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  clampScale,
  resizeRect,
  scaledRectFromHandle,
  scaleWithin,
  unionRects,
  type Handle,
  type Point as WorldPoint,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { setTextWidthFixed } from '../../shared/objects/text';
import { createCanvasMeasurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import type { Selection } from './useSelection';

export interface CameraLike {
  x: number;
  y: number;
  zoom: number;
}

interface GestureOptions {
  doc: Y.Doc;
  camera: CameraLike;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

interface MoveState {
  kind: 'move';
  pointerId: number;
  startClient: { x: number; y: number };
  /** Captured once the drag threshold is crossed; null until then (click). */
  startRects: Map<string, Rect> | null;
}

interface ResizeState {
  kind: 'resize';
  pointerId: number;
  handle: Handle;
  startClient: { x: number; y: number };
  startBounds: Rect;
  startRects: Map<string, Rect>;
  aspectLocked: boolean;
  started: boolean;
  /** Set when the selection is a single text object (horizontal-only resize). */
  singleTextId: string | null;
}

type State = MoveState | ResizeState;

/**
 * Shared move + resize gesture for the selected objects (story 7,
 * sel.transform). One pointer interaction moves the whole selection by the
 * pointer delta (world units) or resizes it around the grabbed handle, with
 * rAF-throttled absolute writes, a 2px click/drag threshold, per-type min size
 * and MAX_OBJECT_SIZE_WORLD clamping. `onGestureStart` fires exactly once per
 * real drag (after the threshold); `onGestureEnd` always, even on cancel — the
 * last applied position survives.
 */
export function useTransformGesture(opts: GestureOptions) {
  // Latest values for the stable window handlers (callbacks included, so
  // inline arrow props from parents never go stale).
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stateRef = useRef<State | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const measureRef = useRef(createCanvasMeasurer());

  const captureRects = useCallback((): Map<string, Rect> | null => {
    const { snapshot, selection } = optsRef.current;
    const rects = new Map<string, Rect>();
    for (const obj of snapshot) {
      if (selection.ids.has(obj.id)) rects.set(obj.id, objectBounds(obj));
    }
    return rects.size > 0 ? rects : null;
  }, []);

  const applyMove = useCallback((delta: WorldPoint) => {
    const { doc } = optsRef.current;
    const state = stateRef.current;
    if (state?.kind !== 'move' || !state.startRects) return;
    const positions = new Map<string, WorldPoint>();
    for (const [id, r] of state.startRects) {
      positions.set(id, { x: r.x + delta.x, y: r.y + delta.y });
    }
    moveObjects(doc, positions);
  }, []);

  const applyResize = useCallback((clientDelta: { x: number; y: number }, shiftKey: boolean) => {
    const { doc, snapshot, camera } = optsRef.current;
    const state = stateRef.current;
    if (state?.kind !== 'resize') return;
    const delta: WorldPoint = { x: clientDelta.x / camera.zoom, y: clientDelta.y / camera.zoom };

    // Single text object: horizontal-only resize (w/e handles). The drag
    // commits a fixed width (setTextWidthFixed); the height is remeasured
    // from content at gesture end.
    if (state.singleTextId && (state.handle === 'w' || state.handle === 'e')) {
      const obj = snapshot.find((o) => o.id === state.singleTextId);
      if (!obj || obj.type !== 'text') return;
      const start = state.startBounds;
      let newWidth: number;
      let newX = start.x;
      if (state.handle === 'e') {
        newWidth = start.width + delta.x;
      } else {
        newWidth = start.width - delta.x;
        newX = start.x + delta.x;
      }
      const minSize = getObjectType('text')?.minSize ?? 0;
      newWidth = Math.max(minSize, Math.min(MAX_OBJECT_SIZE_WORLD, newWidth));
      if (state.handle === 'w') newX = start.x + start.width - newWidth;
      // A horizontal handle drag on a single text commits a fixed width
      // (design: "calls setTextWidthFixed"); the height is remeasured from
      // content at the end of the gesture.
      setTextWidthFixed(doc, state.singleTextId, newWidth);
      if (newX !== start.x) {
        moveObjects(doc, new Map([[state.singleTextId, { x: newX, y: start.y }]]));
      }
      return;
    }

    const aspectLocked = state.aspectLocked || shiftKey;
    const newBounds = resizeRect(state.startBounds, state.handle, delta, aspectLocked);
    const scale: WorldPoint =
      state.startBounds.width > 0 && state.startBounds.height > 0
        ? {
            x: newBounds.width / state.startBounds.width,
            y: newBounds.height / state.startBounds.height,
          }
        : { x: 1, y: 1 };

    const rects = [...state.startRects.values()];
    const minSizes = [...state.startRects.keys()].map((id) => {
      const obj = snapshot.find((o) => o.id === id);
      return obj ? (getObjectType(obj.type)?.minSize ?? 0) : 0;
    });
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const finalBounds = scaledRectFromHandle(state.startBounds, state.handle, clamped);

    const next = new Map<string, Rect>();
    for (const [id, r] of state.startRects) {
      next.set(id, scaleWithin(r, state.startBounds, finalBounds));
    }
    resizeObjects(doc, next);
  }, []);

  const scheduleApply = useCallback((apply: () => void) => {
    pendingRef.current = apply;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        p?.();
      });
    }
  }, []);

  /** Apply the latest pending write synchronously (gesture end/cancel). */
  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    p?.();
  }, []);

  const endGesture = useCallback(
    (pointerId: number) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== pointerId) return;
      const started = state.kind === 'move' ? state.startRects !== null : state.started;
      if (started) flush();
      // Remeasure a single text object's box after a horizontal resize so the
      // height reflects the content at the new width (auto) or the committed
      // width (fixed).
      if (started && state.kind === 'resize' && state.singleTextId) {
        remeasureTextBox(optsRef.current.doc, state.singleTextId, measureRef.current);
      }
      stateRef.current = null;
      optsRef.current.onGestureEnd?.();
    },
    [flush]
  );

  // ---- window listeners -----------------------------------------------------

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = stateRef.current;

      if (!state || e.pointerId !== state.pointerId) return;
      const { camera, doc, onGestureStart: gestureStart, onGestureEnd: gestureEnd } = optsRef.current;

      if (state.startRects === null && state.kind === 'move') {
        // Threshold check before the first write: < DRAG_THRESHOLD_PX is a click.
        const dist = Math.hypot(e.clientX - state.startClient.x, e.clientY - state.startClient.y);
        if (dist < DRAG_THRESHOLD_PX) return;
        const rects = captureRects();
        if (!rects) {
          stateRef.current = null;
          gestureEnd?.();
          return;
        }
        state.startRects = rects;
        bringObjectsToFront(doc, [...rects.keys()]);
        gestureStart?.();
      } else if (state.kind === 'resize' && !state.started) {
        const dist = Math.hypot(e.clientX - state.startClient.x, e.clientY - state.startClient.y);
        if (dist < DRAG_THRESHOLD_PX) return;
        state.started = true;
        bringObjectsToFront(doc, [...state.startRects.keys()]);
        gestureStart?.();
      }

      const delta: WorldPoint = {
        x: (e.clientX - state.startClient.x) / camera.zoom,
        y: (e.clientY - state.startClient.y) / camera.zoom,
      };
      if (state.kind === 'move') {
        scheduleApply(() => applyMove(delta));
      } else {
        const clientDelta = { x: e.clientX - state.startClient.x, y: e.clientY - state.startClient.y };
        scheduleApply(() => applyResize(clientDelta, e.shiftKey));
      }
    };

    const onPointerUp = (e: PointerEvent) => endGesture(e.pointerId);
    const onPointerCancel = (e: PointerEvent) => endGesture(e.pointerId);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
    };
  }, [applyMove, applyResize, captureRects, endGesture, scheduleApply]);

  // ---- entry points -----------------------------------------------------------

  /** Object pointer-down: select (shift/ctrl toggles into the selection) and start a move gesture. */
  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    // The object consumes the pointer: the viewport must not pan.
    e.stopPropagation();
    const { selection, canEdit } = optsRef.current;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      selection.toggle(id);
    } else if (!selection.ids.has(id)) {
      selection.click(id);
    }
    if (!canEdit) return;
    // An empty (post-toggle) selection has nothing to move: the first move
    // past the threshold then aborts the gesture (captureRects → null).
    stateRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startRects: null,
    };
  }, []);

  /** Resize-handle pointer-down: start a resize gesture on the selection. */
  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    // Suppress the default action: without this Chromium starts a native
    // drag session on the first move, which fires pointercancel and kills
    // the gesture (observed in e2e on the second+ handle drag).
    e.preventDefault();
    const { selection, snapshot, canEdit } = optsRef.current;
    if (!canEdit || selection.ids.size === 0) return;

    const rects = new Map<string, Rect>();
    let resizable = false;
    let anyAspectLocked = false;
    for (const obj of snapshot) {
      if (!selection.ids.has(obj.id)) continue;
      const spec = getObjectType(obj.type);
      if (!spec) continue;
      if (spec.resizable) {
        resizable = true;
        if (spec.aspectLocked) anyAspectLocked = true;
      }
      rects.set(obj.id, objectBounds(obj));
    }
    if (!resizable || rects.size === 0) return;

    const bounds = unionRects([...rects.values()]);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    // A single text object resizes horizontally only (story 9).
    const singleTextId =
      selection.ids.size === 1 &&
      snapshot.find((o) => selection.ids.has(o.id))?.type === 'text'
        ? [...selection.ids][0]
        : null;

    stateRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      startBounds: bounds,
      startRects: rects,
      aspectLocked: anyAspectLocked,
      started: false,
      singleTextId,
    };
  }, []);

  return { onObjectPointerDown, onHandlePointerDown };
}
