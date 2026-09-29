import { useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { type Handle, type Rect, resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
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

export interface TransformGestureResult {
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onObjectPointerMove(e: PointerEvent): void;
  onObjectPointerUp(e: PointerEvent): void;
  onObjectPointerCancel(e: PointerEvent): void;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
  onHandlePointerMove(e: PointerEvent): void;
  onHandlePointerUp(e: PointerEvent): void;
  onHandlePointerCancel(e: PointerEvent): void;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  mode: 'idle' | 'pressed' | 'moving' | 'resizing';
  handle?: Handle;
  // Start rects for all selected objects (captured at threshold crossing).
  startRects?: Map<string, Rect>;
  // Bounding box at start
  startBox?: Rect;
  // Frame id for rAF throttling
  frame: number | null;
  // Target positions for current frame
  targetX: number;
  targetY: number;
  // Shift held during resize
  shiftHeld?: boolean;
  // If set and gesture ends as click (no drag), replace selection with just this id.
  replaceOnRelease?: string;
}

/**
 * Generic transform gesture: group move and bounding-box resize.
 * Each selected object has an object-based handler in the object component;
 * this hook is called from the component's pointer events.
 */
export function useTransformGesture(opts: TransformGestureOpts): TransformGestureResult {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pressRef = useRef<Press | null>(null);

  const applyMove = useCallback(() => {
    const p = pressRef.current;
    if (!p || p.mode !== 'moving') return;
    p.frame = null;
    const { doc, camera, selection, canEdit } = optsRef.current;
    if (!canEdit) return;

    const zoom = camera.zoom;
    const dx = (p.targetX - p.startX) / zoom;
    const dy = (p.targetY - p.startY) / zoom;

    // Write absolute positions: start + delta.
    const positions = new Map<string, Point>();
    for (const [id, rect] of p.startRects!) {
      if (!selection.ids.has(id)) continue;
      positions.set(id, { x: rect.x + dx, y: rect.y + dy });
    }
    if (positions.size > 0) moveObjects(doc, positions);
  }, []);

  const applyResize = useCallback(() => {
    const p = pressRef.current;
    if (!p || p.mode !== 'resizing') return;
    p.frame = null;
    const { doc, camera, selection, canEdit } = optsRef.current;
    if (!canEdit) return;

    const zoom = camera.zoom;
    const dx = (p.targetX - p.startX) / zoom;
    const dy = (p.targetY - p.startY) / zoom;

    // Aspect lock check
    let aspectLocked = false;
    const minSizes: number[] = [];
    const rects: Rect[] = [];
    const ids: string[] = [];

    for (const id of selection.ids) {
      const obj = optsRef.current.snapshot.find((o) => o.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec && spec.aspectLocked) aspectLocked = true;
      const rect = p.startRects!.get(id);
      if (!rect) continue;
      rects.push(rect);
      minSizes.push(spec ? spec.minSize : 0);
      ids.push(id);
    }

    if (!p.startBox) return;

    // Determine effective aspect lock: any selected type aspect-locked, or Shift held.
    const effectiveAspect = aspectLocked || !!p.shiftHeld;

    // Resize the bounding box
    const newBox = resizeRect(p.startBox, p.handle!, { x: dx, y: dy }, effectiveAspect);

    // Compute scale
    const scaleX = p.startBox.width !== 0 ? newBox.width / p.startBox.width : 1;
    const scaleY = p.startBox.height !== 0 ? newBox.height / p.startBox.height : 1;

    // Clamp scale
    const clamped = clampScale({ x: scaleX, y: scaleY }, rects, minSizes, MAX_OBJECT_SIZE_WORLD);

    // Apply clamped scale to new box
    const finalBox: Rect = {
      x: newBox.x,
      y: newBox.y,
      width: p.startBox.width * clamped.x,
      height: p.startBox.height * clamped.y,
    };
    // Adjust position for handles on left/top edges
    if (p.handle!.includes('w')) finalBox.x = p.startBox.x + p.startBox.width - finalBox.width;
    if (p.handle!.includes('n')) finalBox.y = p.startBox.y + p.startBox.height - finalBox.height;

    // Scale each child within the new box
    const newRects = new Map<string, Rect>();
    for (let i = 0; i < ids.length; i++) {
      newRects.set(ids[i], scaleWithin(rects[i], p.startBox, finalBox));
    }
    resizeObjects(doc, newRects);
  }, []);

  const finishPress = useCallback((release?: { clientX: number; clientY: number }) => {
    const p = pressRef.current;
    if (!p) return;
    if (p.frame !== null) {
      cancelAnimationFrame(p.frame);
      p.frame = null;
    }

    if (release && (p.mode === 'moving' || p.mode === 'resizing')) {
      // Apply final position at release point.
      p.targetX = release.clientX;
      p.targetY = release.clientY;
      if (p.mode === 'moving') applyMove();
      else applyResize();
    }

    pressRef.current = null;
    const { onGestureEnd, selection } = optsRef.current;

    // Deferred selection replacement: if we pressed an already-selected object in a multi-selection
    // and it turned out to be a click (no drag), replace selection with just that id.
    if (p.replaceOnRelease && p.mode === 'pressed') {
      selection.click(p.replaceOnRelease);
    }

    if (onGestureEnd && (p.mode === 'moving' || p.mode === 'resizing')) {
      onGestureEnd();
    }
  }, [applyMove, applyResize]);

  /** Called from an object component's pointerdown handler. */
  const onObjectPointerDown = useCallback((e: PointerEvent, id: string) => {
    const { selection, canEdit } = optsRef.current;
    if (!canEdit) return;

    // If the object is not selected, select it only.
    const isMulti = selection.ids.size > 1 && selection.ids.has(id);
    if (!selection.ids.has(id)) {
      selection.click(id);
    }

    // Don't start a gesture if already in one.
    if (pressRef.current) return;

    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'pressed',
      frame: null,
      targetX: e.clientX,
      targetY: e.clientY,
      // Track whether we need to replace selection on release (click vs drag).
      replaceOnRelease: isMulti ? id : undefined,
    };
  }, []);

  /** Called when pointer moves during a gesture on an object. */
  const onObjectPointerMove = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId) return;

    p.targetX = e.clientX;
    p.targetY = e.clientY;

    if (p.mode === 'pressed') {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      // Threshold crossed: record start rects.
      const { selection, snapshot, doc, onGestureStart } = optsRef.current;
      const ids = [...selection.ids];
      const startRects = new Map<string, Rect>();
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (obj) startRects.set(id, objectBounds(obj));
      }
      p.startRects = startRects;
      p.mode = 'moving';

      // Bring selection to front.
      if (startRects.size > 0) {
        bringObjectsToFront(doc, ids);
      }

      onGestureStart?.();

      if (p.frame === null) p.frame = requestAnimationFrame(applyMove);
    } else if (p.mode === 'moving') {
      if (p.frame === null) p.frame = requestAnimationFrame(applyMove);
    }
  }, [applyMove]);

  /** Called when pointer up/cancel during a gesture on an object. */
  const onObjectPointerUp = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId) return;
    finishPress({ clientX: e.clientX, clientY: e.clientY });
  }, [finishPress]);

  const onObjectPointerCancel = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId) return;
    finishPress();
  }, [finishPress]);

  /** Called from a resize handle's pointerdown. */
  const onHandlePointerDown = useCallback((e: PointerEvent, handle: Handle) => {
    const { selection, snapshot, canEdit } = optsRef.current;
    if (!canEdit) return;

    // Check if any selected type is resizable.
    let anyResizable = false;
    const startRects = new Map<string, Rect>();
    for (const id of selection.ids) {
      const obj = snapshot.find((o) => o.id === id);
      if (!obj) continue;
      const spec = getObjectType(obj.type);
      if (spec && spec.resizable) anyResizable = true;
      startRects.set(id, objectBounds(obj));
    }
    if (!anyResizable) return;

    const rects = [...startRects.values()];
    const startBox = unionRects(rects);
    if (!startBox) return;

    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      mode: 'pressed',
      handle,
      startRects,
      startBox,
      frame: null,
      targetX: e.clientX,
      targetY: e.clientY,
      shiftHeld: e.shiftKey,
    };

    optsRef.current.onGestureStart?.();
  }, []);

  /** Called when pointer moves during a handle gesture. */
  const onHandlePointerMove = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId || p.mode === 'idle') return;

    p.targetX = e.clientX;
    p.targetY = e.clientY;
    // Update shift state.
    (p as Press & { shiftHeld: boolean }).shiftHeld = e.shiftKey;

    if (p.mode === 'pressed') {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      p.mode = 'resizing';
    }

    if (p.mode === 'resizing' && p.frame === null) {
      p.frame = requestAnimationFrame(applyResize);
    }
  }, [applyResize]);

  /** Called when pointer up/cancel during a handle gesture. */
  const onHandlePointerUp = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId) return;
    finishPress({ clientX: e.clientX, clientY: e.clientY });
  }, [finishPress]);

  const onHandlePointerCancel = useCallback((e: PointerEvent) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.pointerId) return;
    finishPress();
  }, [finishPress]);

  return {
    onObjectPointerDown,
    onObjectPointerMove,
    onObjectPointerUp,
    onObjectPointerCancel,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  } as TransformGestureResult;
}
