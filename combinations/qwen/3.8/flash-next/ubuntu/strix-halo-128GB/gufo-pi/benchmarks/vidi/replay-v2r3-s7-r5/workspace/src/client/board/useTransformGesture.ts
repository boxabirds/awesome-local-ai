import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import type { Rect, Handle } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

type GestureState = 'idle' | 'pressed' | 'moving' | 'resizing';

interface GestureData {
  pointerId: number;
  startX: number;
  startY: number;
  state: GestureState;
  startPositions: Map<string, { x: number; y: number }>;
  handle?: Handle;
  startBBox?: Rect;
  startRects?: Map<string, Rect>;
  aspectLocked?: boolean;
  raf: number | null;
  latestX: number;
  latestY: number;
  zoom: number;
}

/**
 * Handles group move (drag any selected object) and bounding-box resize (drag handle).
 */
export function useTransformGesture(opts: TransformGestureOpts) {
  const { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd } = opts;
  const gestureRef = useRef<GestureData | null>(null);
  const [dragging, setDragging] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const callbacksRef = useRef({ onGestureStart, onGestureEnd });
  callbacksRef.current = { onGestureStart, onGestureEnd };
  const docRef = useRef(doc);
  docRef.current = doc;

  const cleanup = useCallback(() => {
    const g = gestureRef.current;
    if (g?.raf != null) cancelAnimationFrame(g.raf);
    if (g && (g.state === 'moving' || g.state === 'resizing')) {
      setDragging(false);
    }
    gestureRef.current = null;
    window.removeEventListener('pointermove', moveHandler);
    window.removeEventListener('pointerup', upHandler);
    window.removeEventListener('pointercancel', cancelHandler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveHandler(e: PointerEvent) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    g.latestX = e.clientX;
    g.latestY = e.clientY;

    if (g.state === 'pressed') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!canEditRef.current) { cleanup(); return; }
      g.state = g.handle ? 'resizing' : 'moving';
      setDragging(true);
      if (g.state === 'moving') {
        bringObjectsToFront(docRef.current, [...selectionRef.current.ids]);
      }
      callbacksRef.current.onGestureStart?.();
    }

    if (g.raf === null) {
      g.raf = requestAnimationFrame(() => {
        g.raf = null;
        applyFrame(g);
      });
    }
  }

  function upHandler(e: PointerEvent) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.state === 'moving' || g.state === 'resizing') {
      g.latestX = e.clientX;
      g.latestY = e.clientY;
      applyFrame(g);
      callbacksRef.current.onGestureEnd?.();
    }
    cleanup();
  }

  function cancelHandler(e: PointerEvent) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.state === 'moving' || g.state === 'resizing') {
      callbacksRef.current.onGestureEnd?.();
    }
    cleanup();
  }

  function applyFrame(g: GestureData) {
    const d = docRef.current;
    if (g.state === 'moving') {
      const dx = (g.latestX - g.startX) / g.zoom;
      const dy = (g.latestY - g.startY) / g.zoom;
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, start] of g.startPositions) {
        positions.set(id, { x: start.x + dx, y: start.y + dy });
      }
      moveObjects(d, positions);
    } else if (g.state === 'resizing' && g.handle && g.startBBox && g.startRects) {
      const dx = (g.latestX - g.startX) / g.zoom;
      const dy = (g.latestY - g.startY) / g.zoom;
      const newBBox = resizeRect(g.startBBox, g.handle, { x: dx, y: dy }, g.aspectLocked ?? false);

      const scaleX = newBBox.width / g.startBBox.width;
      const scaleY = newBBox.height / g.startBBox.height;

      const rects: Rect[] = [];
      const minSizes: number[] = [];
      for (const [, r] of g.startRects) {
        rects.push(r);
      }
      // Use min size from registry - look up from current snapshot types
      for (const [id] of g.startRects) {
        const obj = snapshotRef.current.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        minSizes.push(spec?.minSize ?? 0);
      }

      const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

      const actualBBox: Rect = (() => {
        let anchorX = g.startBBox!.x;
        let anchorY = g.startBBox!.y;
        const h = g.handle!;
        if (h.includes('w')) anchorX = g.startBBox!.x + g.startBBox!.width;
        if (h.includes('n')) anchorY = g.startBBox!.y + g.startBBox!.height;

        const newW = g.startBBox!.width * clamped.x;
        const newH = g.startBBox!.height * clamped.y;

        let newX = anchorX - newW;
        let newY = anchorY - newH;
        if (!h.includes('w')) newX = anchorX;
        if (!h.includes('n')) newY = anchorY;

        return { x: newX, y: newY, width: newW, height: newH };
      })();

      const resizeMap = new Map<string, Rect>();
      for (const [id, r] of g.startRects) {
        resizeMap.set(id, scaleWithin(r, g.startBBox!, actualBBox));
      }
      resizeObjects(d, resizeMap);
    }
  }

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent, id: string) => {
      if (!canEditRef.current) return;
      if (e.button !== 0 && (e as any).pointerType === 'mouse') return;

      const isShift = !!(e as any).shiftKey;
      if (isShift) {
        // Shift-click: toggle, don't start gesture
        selectionRef.current.toggle(id);
        return;
      }

      if (!selectionRef.current.ids.has(id)) {
        selectionRef.current.click(id);
      }

      const startPositions = new Map<string, { x: number; y: number }>();
      const snap = snapshotRef.current;
      // If id was NOT already selected, we're starting a new single-object gesture
      const wasAlreadySelected = selectionRef.current.ids.has(id);
      const ids = wasAlreadySelected ? new Set(selectionRef.current.ids) : new Set([id]);
      for (const obj of snap) {
        if (ids.has(obj.id)) {
          startPositions.set(obj.id, { x: obj.x, y: obj.y });
        }
      }

      const pe = e as PointerEvent;
      gestureRef.current = {
        pointerId: pe.pointerId ?? 0,
        startX: (e as any).clientX,
        startY: (e as any).clientY,
        state: 'pressed',
        startPositions,
        raf: null,
        latestX: (e as any).clientX,
        latestY: (e as any).clientY,
        zoom: cameraRef.current.zoom || 1,
      };

      window.addEventListener('pointermove', moveHandler);
      window.addEventListener('pointerup', upHandler);
      window.addEventListener('pointercancel', cancelHandler);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent, handle: Handle) => {
      if (!canEditRef.current) return;

      const snap = snapshotRef.current;
      const ids = selectionRef.current.ids;
      const selectedRects = new Map<string, Rect>();
      let hasResizable = false;

      for (const obj of snap) {
        if (ids.has(obj.id)) {
          const spec = getObjectType(obj.type);
          if (!spec?.resizable) continue;
          hasResizable = true;
          selectedRects.set(obj.id, objectBounds(obj));
        }
      }

      if (!hasResizable) return;

      const bbox = unionRects([...selectedRects.values()]);
      if (!bbox) return;

      let aspectLocked = (e as any).shiftKey ?? false;
      for (const obj of snap) {
        if (ids.has(obj.id)) {
          const spec = getObjectType(obj.type);
          if (spec?.aspectLocked) { aspectLocked = true; break; }
        }
      }

      gestureRef.current = {
        pointerId: (e as any).pointerId ?? 0,
        startX: (e as any).clientX,
        startY: (e as any).clientY,
        state: 'pressed',
        startPositions: new Map(),
        handle,
        startBBox: bbox,
        startRects: selectedRects,
        aspectLocked,
        raf: null,
        latestX: (e as any).clientX,
        latestY: (e as any).clientY,
        zoom: cameraRef.current.zoom || 1,
      };

      window.addEventListener('pointermove', moveHandler);
      window.addEventListener('pointerup', upHandler);
      window.addEventListener('pointercancel', cancelHandler);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, dragging };
}
