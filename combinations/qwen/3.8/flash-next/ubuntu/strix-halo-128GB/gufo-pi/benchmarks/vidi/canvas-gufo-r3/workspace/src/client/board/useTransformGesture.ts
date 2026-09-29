import { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Camera, Point } from '@client/canvas/camera';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '@shared/config';
import {
  ObjectSnapshot,
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
} from '@shared/board-model';
import { Rect, Handle, unionRects, resizeRect, clampScale, scaleWithin } from '@shared/geometry';
import { SelectionApi } from './useSelection';
import { getObjectType } from '@client/objects/registry';
import { setTextWidthFixed } from '@shared/objects/text';
import { layoutText, createCanvasMeasurer } from '@client/objects/textLayout';
import type { TextSize } from '@shared/config';

const gestureMeasurer = createCanvasMeasurer();

export interface UseTransformGestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface UseTransformGestureResult {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  /** The id of the object currently being dragged, or null */
  draggingId: string | null;
}

type GestureMode = 'idle' | 'pressed' | 'moving' | 'resizing';

export function useTransformGesture(opts: UseTransformGestureOpts): UseTransformGestureResult {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const modeRef = useRef<GestureMode>('idle');
  const draggingIdRef = useRef<string | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startScreenRef = useRef<Point>({ x: 0, y: 0 });
  const startRectsRef = useRef<Map<string, Rect>>(new Map());
  const bboxRef = useRef<Rect | null>(null);
  const handleRef = useRef<Handle>('se');
  const aspectLockedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const gestureStartCalledRef = useRef(false);

  // Keep refs to latest props
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onGestureStartRef = useRef(opts.onGestureStart);
  onGestureStartRef.current = opts.onGestureStart;
  const onGestureEndRef = useRef(opts.onGestureEnd);
  onGestureEndRef.current = opts.onGestureEnd;

  const recordStartRects = useCallback((ids: ReadonlySet<string>) => {
    const map = new Map<string, Rect>();
    for (const obj of snapshotRef.current) {
      if (ids.has(obj.id)) {
        map.set(obj.id, objectBounds(obj));
      }
    }
    startRectsRef.current = map;
    bboxRef.current = unionRects([...map.values()]);
  }, []);

  const cleanupRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const finishGesture = useCallback(() => {
    cleanupRaf();
    if (gestureStartCalledRef.current) {
      gestureStartCalledRef.current = false;
      onGestureEndRef.current?.();
    }
    modeRef.current = 'idle';
    pointerIdRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
  }, [cleanupRaf]);

  const applyMoveFrame = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p || modeRef.current !== 'moving') return;

    const cam = cameraRef.current;
    const start = startScreenRef.current;
    const dx = (p.x - start.x) / cam.zoom;
    const dy = (p.y - start.y) / cam.zoom;

    const positions = new Map<string, Point>();
    for (const [id, rect] of startRectsRef.current) {
      positions.set(id, { x: rect.x + dx, y: rect.y + dy });
    }
    if (positions.size > 0) {
      moveObjects(docRef.current, positions);
    }
  }, []);

  const applyResizeFrame = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p || modeRef.current !== 'resizing') return;

    const cam = cameraRef.current;
    const start = startScreenRef.current;
    const dx = (p.x - start.x) / cam.zoom;
    const dy = (p.y - start.y) / cam.zoom;

    const bbox = bboxRef.current;
    if (!bbox) return;

    const newBbox = resizeRect(bbox, handleRef.current, { x: dx, y: dy }, aspectLockedRef.current);

    // Compute scale
    const scaleX = bbox.width > 0 ? newBbox.width / bbox.width : 1;
    const scaleY = bbox.height > 0 ? newBbox.height / bbox.height : 1;

    // Gather min sizes from registered types
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    for (const [, rect] of startRectsRef.current) {
      rects.push(rect);
    }
    for (const [id] of startRectsRef.current) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      const spec = obj ? getObjectType(obj.type) : undefined;
      minSizes.push(spec ? spec.minSize : 50);
    }

    const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    // Compute final bbox with clamped scale
    const finalBbox: Rect = aspectLockedRef.current
      ? { x: newBbox.x, y: newBbox.y, width: bbox.width * clamped.x, height: bbox.height * clamped.x }
      : {
          x: newBbox.x,
          y: newBbox.y,
          width: bbox.width * clamped.x,
          height: bbox.height * clamped.y,
        };

    // Recompute position for the clamped size based on handle
    if (handleRef.current.includes('w')) {
      finalBbox.x = bbox.x + bbox.width - finalBbox.width;
    }
    if (handleRef.current.includes('n')) {
      finalBbox.y = bbox.y + bbox.height - finalBbox.height;
    }

    const rectsMap = new Map<string, Rect>();
    for (const [id, rect] of startRectsRef.current) {
      const scaled = scaleWithin(rect, bbox, finalBbox);
      rectsMap.set(id, scaled);
    }

    // Text objects with horizontal-only handles: width is set as fixed, height follows
    // the content (re-wrap). Font size never changes via handles.
    for (const [id] of startRectsRef.current) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (obj && obj.type === 'text') {
        const spec = getObjectType('text');
        if (spec?.handles === 'horizontal') {
          const m = docRef.current.getMap('objects').get(id) as Y.Map<unknown> | undefined;
          if (m && m instanceof Y.Map) {
            const size = m.get('size') as TextSize;
            const yt = m.get('text');
            const text = yt instanceof Y.Text ? yt.toString() : '';
            const newWidth = rectsMap.get(id)!.width;
            const res = layoutText(text, size, 'fixed', newWidth, gestureMeasurer);
            rectsMap.set(id, { x: rectsMap.get(id)!.x, y: rectsMap.get(id)!.y, width: res.width, height: res.height });
            setTextWidthFixed(docRef.current, id, res.width);
          }
        }
      }
    }

    if (rectsMap.size > 0) {
      resizeObjects(docRef.current, rectsMap);
    }
  }, []);

  const scheduleFrame = useCallback((x: number, y: number) => {
    pendingRef.current = { x, y };
    if (rafRef.current === null) {
      if (modeRef.current === 'moving') {
        rafRef.current = requestAnimationFrame(applyMoveFrame);
      } else if (modeRef.current === 'resizing') {
        rafRef.current = requestAnimationFrame(applyResizeFrame);
      }
    }
  }, [applyMoveFrame, applyResizeFrame]);

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    if (!canEditRef.current) return;
    e.stopPropagation();
    // If editing another object, end editing first
    if (selectionRef.current.editingId && selectionRef.current.editingId !== id) {
      selectionRef.current.endEdit('selected');
    }
    if (selectionRef.current.editingId === id) return;

    // If not selected, select only this
    if (!selectionRef.current.ids.has(id)) {
      selectionRef.current.click(id);
    }

    pointerIdRef.current = e.pointerId;
    startScreenRef.current = { x: e.clientX, y: e.clientY };
    modeRef.current = 'pressed';
    draggingIdRef.current = id;

    const onMove = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      const dx = ev.clientX - startScreenRef.current.x;
      const dy = ev.clientY - startScreenRef.current.y;

      if (modeRef.current === 'pressed') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        modeRef.current = 'moving';
        recordStartRects(selectionRef.current.ids);
        bringObjectsToFront(docRef.current, [...selectionRef.current.ids]);
        if (!gestureStartCalledRef.current) {
          gestureStartCalledRef.current = true;
          onGestureStartRef.current?.();
        }
        setDraggingId(draggingIdRef.current);
      }

      if (modeRef.current === 'moving') {
        scheduleFrame(ev.clientX, ev.clientY);
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      // Apply final position synchronously
      if (modeRef.current === 'moving' && pendingRef.current) {
        cleanupRaf();
        applyMoveFrame();
      }
      finishGesture();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    const onCancel = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      finishGesture();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [recordStartRects, scheduleFrame, cleanupRaf, applyMoveFrame, finishGesture]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (!canEditRef.current) return;
    e.stopPropagation();
    e.preventDefault();

    // Check if any selected type is resizable
    const selectedTypes = new Set<string>();
    for (const obj of snapshotRef.current) {
      if (selectionRef.current.ids.has(obj.id)) {
        selectedTypes.add(obj.type);
      }
    }
    let anyResizable = false;
    let anyAspectLocked = e.shiftKey; // Shift forces aspect lock
    for (const t of selectedTypes) {
      const spec = getObjectType(t);
      if (spec) {
        if (spec.resizable) anyResizable = true;
        if (spec.aspectLocked) anyAspectLocked = true;
      }
    }
    if (!anyResizable) return;

    pointerIdRef.current = e.pointerId;
    startScreenRef.current = { x: e.clientX, y: e.clientY };
    handleRef.current = handle;
    aspectLockedRef.current = anyAspectLocked;
    modeRef.current = 'pressed'; // will transition to 'resizing'

    recordStartRects(selectionRef.current.ids);

    const onMove = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      const dx = ev.clientX - startScreenRef.current.x;
      const dy = ev.clientY - startScreenRef.current.y;

      if (modeRef.current === 'pressed') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        modeRef.current = 'resizing';
        if (!gestureStartCalledRef.current) {
          gestureStartCalledRef.current = true;
          onGestureStartRef.current?.();
        }
      }

      if (modeRef.current === 'resizing') {
        scheduleFrame(ev.clientX, ev.clientY);
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      if (modeRef.current === 'resizing' && pendingRef.current) {
        cleanupRaf();
        applyResizeFrame();
      }
      finishGesture();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    const onCancel = (ev: PointerEvent) => {
      if (pointerIdRef.current !== ev.pointerId) return;
      finishGesture();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [recordStartRects, scheduleFrame, cleanupRaf, applyResizeFrame, finishGesture]);

  return { onObjectPointerDown, onHandlePointerDown, draggingId };
}
