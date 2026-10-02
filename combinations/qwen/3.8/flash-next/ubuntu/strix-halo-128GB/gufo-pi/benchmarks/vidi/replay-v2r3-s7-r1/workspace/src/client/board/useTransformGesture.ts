import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import type { Rect, Handle, Point } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import type { UseSelectionResult } from './useSelection';
import { getObjectType } from '../objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureResult {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

type GestureState =
  | { kind: 'idle' }
  | { kind: 'pressed'; pointerId: number; startX: number; startY: number; id: string }
  | { kind: 'moving'; pointerId: number; startClientX: number; startClientY: number; startRects: Map<string, Rect>; zoom: number; raf: number | null; latestClientX: number; latestClientY: number }
  | { kind: 'resizing'; pointerId: number; startClientX: number; startClientY: number; handle: Handle; startBBox: Rect; startRects: Map<string, Rect>; zoom: number; raf: number | null; latestClientX: number; latestClientY: number; aspectLocked: boolean; minSizes: number[] }
  | { kind: 'marquee'; pointerId: number };

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureResult {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;
  const stateRef = useRef<GestureState>({ kind: 'idle' });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const callbacksRef = useRef({ onGestureStart, onGestureEnd });
  callbacksRef.current = { onGestureStart, onGestureEnd };

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    if (!canEditRef.current) return;

    const sel = selectionRef.current;
    if (e.shiftKey) {
      // Shift+click toggles the object in the selection
      const wasSelected = sel.ids.has(id);
      sel.toggle(id);
      // If the object was just deselected, don't start a drag
      if (wasSelected) return;
    } else if (!sel.ids.has(id)) {
      // Click on unselected object: replace selection with just this one
      sel.click(id);
    }

    stateRef.current = {
      kind: 'pressed',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      id,
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (!canEditRef.current) return;
    e.stopPropagation();

    const sel = selectionRef.current;
    const snap = snapshotRef.current;
    const cam = cameraRef.current;

    const selectedObjs = snap.filter((o) => sel.ids.has(o.id));
    if (selectedObjs.length === 0) return;

    // Check if any selected object type is resizable
    let anyResizable = false;
    let aspectLocked = false;
    const minSizes: number[] = [];
    for (const obj of selectedObjs) {
      const spec = getObjectType(obj.type);
      if (spec) {
        if (spec.resizable) anyResizable = true;
        if (spec.aspectLocked) aspectLocked = true;
        minSizes.push(spec.minSize);
      } else {
        minSizes.push(10); // fallback
      }
    }

    if (!anyResizable) return;

    // Shift held → aspect locked
    if (e.shiftKey) aspectLocked = true;

    const startRects = new Map<string, Rect>();
    const allRects: Rect[] = [];
    for (const obj of selectedObjs) {
      const r = objectBounds(obj);
      startRects.set(obj.id, r);
      allRects.push(r);
    }

    const startBBox = unionRects(allRects);
    if (!startBBox) return;

    stateRef.current = {
      kind: 'resizing',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      handle,
      startBBox,
      startRects,
      zoom: cam.zoom || 1,
      raf: null,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
      aspectLocked,
      minSizes,
    };

    callbacksRef.current.onGestureStart?.();

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const st = stateRef.current;
    if (st.kind === 'pressed') {
      if (e.pointerId !== st.pointerId) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      // Threshold crossed → start moving
      const sel = selectionRef.current;
      const snap = snapshotRef.current;
      const cam = cameraRef.current;

      if (!canEditRef.current) {
        stateRef.current = { kind: 'idle' };
        return;
      }

      const startRects = new Map<string, Rect>();
      for (const id of sel.ids) {
        const obj = snap.find((o) => o.id === id);
        if (obj) startRects.set(id, objectBounds(obj));
      }

      if (startRects.size === 0) {
        stateRef.current = { kind: 'idle' };
        return;
      }

      bringObjectsToFront(doc, [...startRects.keys()]);
      callbacksRef.current.onGestureStart?.();

      stateRef.current = {
        kind: 'moving',
        pointerId: st.pointerId,
        startClientX: st.startX,
        startClientY: st.startY,
        startRects,
        zoom: cam.zoom || 1,
        raf: null,
        latestClientX: e.clientX,
        latestClientY: e.clientY,
      };
      scheduleMoveFrame();
      return;
    }

    if (st.kind === 'moving') {
      if (e.pointerId !== st.pointerId) return;
      st.latestClientX = e.clientX;
      st.latestClientY = e.clientY;
      scheduleMoveFrame();
      return;
    }

    if (st.kind === 'resizing') {
      if (e.pointerId !== st.pointerId) return;
      st.latestClientX = e.clientX;
      st.latestClientY = e.clientY;
      scheduleResizeFrame();
      return;
    }
  }, [doc]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const st = stateRef.current;
    if (st.kind === 'pressed') {
      if (e.pointerId !== st.pointerId) return;
      // Below threshold: it's a click (already selected on pointerdown)
      cleanup();
      return;
    }

    if (st.kind === 'moving') {
      if (e.pointerId !== st.pointerId) return;
      // Apply final frame
      st.latestClientX = e.clientX;
      st.latestClientY = e.clientY;
      applyMoveFrame();
      cleanup();
      callbacksRef.current.onGestureEnd?.();
      return;
    }

    if (st.kind === 'resizing') {
      if (e.pointerId !== st.pointerId) return;
      st.latestClientX = e.clientX;
      st.latestClientY = e.clientY;
      applyResizeFrame();
      cleanup();
      callbacksRef.current.onGestureEnd?.();
      return;
    }
  }, []);

  const handlePointerCancel = useCallback((e: PointerEvent) => {
    const st = stateRef.current;
    if (st.kind === 'moving' && e.pointerId === st.pointerId) {
      cleanup();
      callbacksRef.current.onGestureEnd?.();
      return;
    }
    if (st.kind === 'resizing' && e.pointerId === st.pointerId) {
      cleanup();
      callbacksRef.current.onGestureEnd?.();
      return;
    }
    if (st.kind === 'pressed' && e.pointerId === st.pointerId) {
      cleanup();
    }
  }, []);

  function cleanup() {
    const st = stateRef.current;
    if (st.kind === 'moving' && st.raf != null) cancelAnimationFrame(st.raf);
    if (st.kind === 'resizing' && st.raf != null) cancelAnimationFrame(st.raf);
    stateRef.current = { kind: 'idle' };
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerCancel);
  }

  function scheduleMoveFrame() {
    const st = stateRef.current;
    if (st.kind !== 'moving') return;
    if (st.raf !== null) return;
    st.raf = requestAnimationFrame(() => {
      const s = stateRef.current;
      if (s.kind !== 'moving') return;
      s.raf = null;
      applyMoveFrame();
    });
  }

  function applyMoveFrame() {
    const st = stateRef.current;
    if (st.kind !== 'moving') return;
    if (!canEditRef.current) return;

    const dx = (st.latestClientX - st.startClientX) / st.zoom;
    const dy = (st.latestClientY - st.startClientY) / st.zoom;

    const positions = new Map<string, Point>();
    for (const [id, rect] of st.startRects) {
      positions.set(id, { x: rect.x + dx, y: rect.y + dy });
    }
    moveObjects(doc, positions);
  }

  function scheduleResizeFrame() {
    const st = stateRef.current;
    if (st.kind !== 'resizing') return;
    if (st.raf !== null) return;
    st.raf = requestAnimationFrame(() => {
      const s = stateRef.current;
      if (s.kind !== 'resizing') return;
      s.raf = null;
      applyResizeFrame();
    });
  }

  function applyResizeFrame() {
    const st = stateRef.current;
    if (st.kind !== 'resizing') return;
    if (!canEditRef.current) return;

    const dx = (st.latestClientX - st.startClientX) / st.zoom;
    const dy = (st.latestClientY - st.startClientY) / st.zoom;

    // Resize the bounding box
    const newBBox = resizeRect(st.startBBox, st.handle, { x: dx, y: dy }, st.aspectLocked);

    // Compute scale
    let sx = st.startBBox.width === 0 ? 1 : newBBox.width / st.startBBox.width;
    let sy = st.startBBox.height === 0 ? 1 : newBBox.height / st.startBBox.height;

    // Clamp scale
    const rects: Rect[] = [];
    for (const [_id, rect] of st.startRects) {
      rects.push(rect);
    }

    const clamped = clampScale({ x: sx, y: sy }, rects, st.minSizes, MAX_OBJECT_SIZE_WORLD);
    sx = clamped.x;
    sy = clamped.y;

    // Build the target bbox using clamped scale
    const targetBBox: Rect = {
      x: newBBox.x,
      y: newBBox.y,
      width: st.startBBox.width * sx,
      height: st.startBBox.height * sy,
    };

    // For aspect-locked, also recalculate target bbox to match the clamped scale
    // The newBBox already has the right aspect from resizeRect; clamped may have
    // clamped one axis more than the other. For aspect-locked, use the more restrictive.
    if (st.aspectLocked) {
      // Use the minimum scale to ensure aspect is maintained
      const uniformScale = Math.min(sx, sy);
      // Recompute the target bbox anchored properly
      const newW = st.startBBox.width * uniformScale;
      const newH = st.startBBox.height * uniformScale;
      // Anchor based on handle
      const h = st.handle;
      let ax = st.startBBox.x;
      let ay = st.startBBox.y;
      if (h.includes('w')) ax = st.startBBox.x + st.startBBox.width - newW;
      if (h.includes('n')) ay = st.startBBox.y + st.startBBox.height - newH;
      targetBBox.x = ax;
      targetBBox.y = ay;
      targetBBox.width = newW;
      targetBBox.height = newH;
    }

    // Scale each object within the bbox mapping
    const resizeMap = new Map<string, Rect>();
    for (const [id, rect] of st.startRects) {
      const scaled = scaleWithin(rect, st.startBBox, targetBBox);
      resizeMap.set(id, scaled);
    }

    resizeObjects(doc, resizeMap);
  }

  return { onObjectPointerDown, onHandlePointerDown };
}
