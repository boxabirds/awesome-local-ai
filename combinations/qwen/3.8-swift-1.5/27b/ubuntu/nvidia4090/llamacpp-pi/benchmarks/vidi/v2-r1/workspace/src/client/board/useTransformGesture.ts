import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import {
  objectBounds, moveObjects, resizeObjects, bringObjectsToFront,
  type ObjectSnapshot,
} from '@shared/board-model';
import { setTextWidthFixed } from '@shared/objects/text';
import {
  resizeRect, clampScale, scaleWithin, unionRects,
  type Rect, type Point, type Handle,
} from '@shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '@shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * Story 7: the generic transform gesture — group move and bounding-box
 * resize (PRD sel.group_move, sel.drag_unselected, sel.resize, sel.aspect,
 * sel.size_limits).
 *
 * Key decisions (design):
 * 1. Absolute writes from gesture start: every frame writes `start + delta`
 *    (or the scaled rect), so concurrent remote moves converge to the last
 *    writer identically on every screen.
 * 2. The group resize scale is clamped ONCE (clampScale) so no object
 *    crosses its min size or MAX_OBJECT_SIZE_WORLD; the whole selection
 *    stops together.
 * 3. Aspect lock: any selected type with `aspectLocked`, or Shift held.
 *
 * `onGestureStart`/`onGestureEnd` fire exactly once per drag (story 8 undo
 * boundaries). A cancelled gesture keeps the last applied state.
 */

type ObjectGesture = {
  kind: 'object';
  phase: 'pressed' | 'moving';
  id: string;
  ids: string[];
  pointerId: number;
  startScreen: Point;
  startRects: Map<string, Rect> | null;
};

type HandleGesture = {
  kind: 'handle';
  phase: 'pressed' | 'resizing';
  handle: Handle;
  ids: string[];
  pointerId: number;
  startScreen: Point;
  startRects: Map<string, Rect> | null;
  startBounds: Rect | null;
};

type Gesture = { kind: 'idle' } | ObjectGesture | HandleGesture;

function specOf(type: string) {
  return getObjectType(type);
}

/** Recompute the bounding box from the opposite anchor at a given scale. */
function applyScaleToRect(start: Rect, handle: Handle, scale: Point): Rect {
  const width = Math.max(0, start.width * scale.x);
  const height = Math.max(0, start.height * scale.y);
  let x = start.x;
  let y = start.y;
  if (handle === 'w' || handle === 'nw' || handle === 'sw') x = start.x + start.width - width;
  if (handle === 'n' || handle === 'ne' || handle === 'nw') y = start.y + start.height - height;
  // Aspect-locked edge handles stay centred on the fixed axis.
  if (handle === 'e' || handle === 'w') y = start.y + (start.height - height) / 2;
  if (handle === 'n' || handle === 's') x = start.x + (start.width - width) / 2;
  return { x, y, width, height };
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
  /**
   * Story 9: called at the end of a handle resize that touched text
   * objects, so the board can re-measure their heights from the (possibly
   * new fixed) width. Fires before `onGestureEnd` so the box write lands
   * in the same undo capture window as the drag.
   */
  onTextsResized?(ids: string[]): void;
}): {
  onObjectPointerDown: (e: React.PointerEvent, id: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, handle: Handle) => void;
} {
  const { doc } = opts;
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onGestureStartRef = useRef(opts.onGestureStart);
  onGestureStartRef.current = opts.onGestureStart;
  const onGestureEndRef = useRef(opts.onGestureEnd);
  onGestureEndRef.current = opts.onGestureEnd;
  const onTextsResizedRef = useRef(opts.onTextsResized);
  onTextsResizedRef.current = opts.onTextsResized;

  const gestureRef = useRef<Gesture>({ kind: 'idle' });
  const startedRef = useRef(false);
  const pendingRef = useRef<
    | { kind: 'move'; positions: Map<string, Point> }
    | { kind: 'resize'; rects: Map<string, Rect> }
    | { kind: 'textWidth'; id: string; width: number }
    | null
  >(null);
  const rafRef = useRef(0);

  const typeOf = useCallback((id: string): string | undefined => {
    return snapshotRef.current.find((o) => o.id === id)?.type;
  }, []);

  // Story 9: the widthMode of a text object, read straight from the doc
  // (the snapshot is updated on the next render; the doc is current).
  const widthModeOf = useCallback((id: string): 'auto' | 'fixed' => {
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
    if (!obj || obj.get('type') !== 'text') return 'auto';
    return obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
  }, [doc]);

  const applyPending = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    if (p.kind === 'move') moveObjects(doc, p.positions);
    else if (p.kind === 'resize') resizeObjects(doc, p.rects);
    else setTextWidthFixed(doc, p.id, p.width);
  }, [doc]);

  const schedule = useCallback((pending: NonNullable<typeof pendingRef.current>) => {
    pendingRef.current = pending;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        applyPending();
      });
    }
  }, [applyPending]);

  const flush = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    applyPending();
  }, [applyPending]);

  const detach = useCallback(() => {
    window.removeEventListener('pointermove', onMoveRef.current);
    window.removeEventListener('pointerup', onUpRef.current);
    window.removeEventListener('pointercancel', onCancelRef.current);
  }, []);

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const onCancelRef = useRef<(e: PointerEvent) => void>(() => {});

  const finish = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = { kind: 'idle' };
    detach();
    if (g.kind !== 'idle') {
      // Keep the last applied state (no rollback).
      flush();
      if (startedRef.current) {
        // Story 9: re-measure text heights after a handle resize, BEFORE
        // the end boundary (same capture window as the drag).
        if (g.kind === 'handle') {
          const textIds = g.ids.filter((id) => typeOf(id) === 'text');
          if (textIds.length > 0) onTextsResizedRef.current?.(textIds);
        }
        onGestureEndRef.current?.();
        startedRef.current = false;
      }
    }
  }, [detach, flush, typeOf]);

  const applyMoveFrame = useCallback((g: ObjectGesture, e: PointerEvent) => {
    if (!canEditRef.current || !g.startRects) return;
    const cam = cameraRef.current;
    const dx = (e.clientX - g.startScreen.x) / cam.zoom;
    const dy = (e.clientY - g.startScreen.y) / cam.zoom;
    const positions = new Map<string, Point>();
    for (const [id, r] of g.startRects) {
      positions.set(id, { x: r.x + dx, y: r.y + dy });
    }
    schedule({ kind: 'move', positions });
  }, [schedule]);

  const applyResizeFrame = useCallback((g: HandleGesture, e: PointerEvent) => {
    if (!canEditRef.current || !g.startRects || !g.startBounds) return;
    const cam = cameraRef.current;
    const worldDelta: Point = {
      x: (e.clientX - g.startScreen.x) / cam.zoom,
      y: (e.clientY - g.startScreen.y) / cam.zoom,
    };
    const aspectLocked =
      e.shiftKey || g.ids.some((id) => specOf(typeOf(id) ?? '')?.aspectLocked === true);
    const raw = resizeRect(g.startBounds, g.handle, worldDelta, aspectLocked);
    const scale: Point = {
      x: raw.width / g.startBounds.width,
      y: raw.height / g.startBounds.height,
    };
    const rects = [...g.startRects.values()];
    // Story 9: an AUTO-width text's width is content-driven, so it must not
    // constrain the group scale (its min size applies to fixed widths only).
    const minSizes = g.ids.map((id) => {
      const t = typeOf(id) ?? '';
      if (t === 'text' && widthModeOf(id) !== 'fixed') return 0;
      return specOf(t)?.minSize ?? 0;
    });
    const clamped = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = applyScaleToRect(g.startBounds, g.handle, clamped);
    const out = new Map<string, Rect>();
    let allText = true;
    for (const [id, r] of g.startRects) {
      const isText = typeOf(id) === 'text';
      if (!isText) allText = false;
      const scaled = scaleWithin(r, g.startBounds, to);
      if (isText) {
        // Story 9: text height is derived from content and never scaled by
        // a handle; the width scales only when fixed (PRD text.resize).
        out.set(id, {
          x: scaled.x,
          y: scaled.y,
          width: widthModeOf(id) === 'fixed' ? scaled.width : r.width,
          height: r.height,
        });
      } else {
        out.set(id, scaled);
      }
    }
    if (allText && g.ids.length === 1) {
      // Story 9: a single text gets a FIXED width from its side handle
      // (min TEXT_MIN_WIDTH_WORLD, enforced in setTextWidthFixed); the
      // height is re-measured by the board on gesture end.
      const [id] = g.ids;
      schedule({ kind: 'textWidth', id, width: out.get(id)!.width });
    } else {
      schedule({ kind: 'resize', rects: out });
    }
  }, [schedule, typeOf, widthModeOf]);

  const beginObjectMove = useCallback((g: ObjectGesture): ObjectGesture => {
    const startRects = new Map<string, Rect>();
    for (const id of g.ids) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (obj) startRects.set(id, objectBounds(obj));
    }
    const started: ObjectGesture = { ...g, phase: 'moving', startRects };
    if (startRects.size > 0) {
      bringObjectsToFront(doc, [...startRects.keys()]);
    }
    return started;
  }, [doc]);

  const beginHandleResize = useCallback((g: HandleGesture): HandleGesture | null => {
    const startRects = new Map<string, Rect>();
    for (const id of g.ids) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (obj) startRects.set(id, objectBounds(obj));
    }
    const bounds = unionRects([...startRects.values()]);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return { ...g, phase: 'resizing', startRects, startBounds: bounds };
  }, []);

  onMoveRef.current = (e: PointerEvent) => {
    const g = gestureRef.current;
    if (g.kind === 'idle' || e.pointerId !== g.pointerId) return;
    const dist = Math.hypot(e.clientX - g.startScreen.x, e.clientY - g.startScreen.y);

    if (g.phase === 'pressed') {
      if (dist < DRAG_THRESHOLD_PX) return;
      if (g.kind === 'object') {
        const started = beginObjectMove(g);
        gestureRef.current = started;
        onGestureStartRef.current?.();
        startedRef.current = true;
        applyMoveFrame(started, e);
      } else {
        const started = beginHandleResize(g);
        if (!started) {
          finish();
          return;
        }
        gestureRef.current = started;
        onGestureStartRef.current?.();
        startedRef.current = true;
        applyResizeFrame(started, e);
      }
      return;
    }

    if (g.kind === 'object') applyMoveFrame(g, e);
    else applyResizeFrame(g, e);
  };

  onUpRef.current = (e: PointerEvent) => {
    const g = gestureRef.current;
    if (g.kind === 'idle' || e.pointerId !== g.pointerId) return;
    finish();
  };

  onCancelRef.current = (e: PointerEvent) => {
    const g = gestureRef.current;
    if (g.kind === 'idle' || e.pointerId !== g.pointerId) return;
    finish();
  };

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    if (gestureRef.current.kind !== 'idle') return;

    // Selection semantics (work even when canEdit is false — selection is
    // for viewing; PRD alternate flow "board failed to load").
    const sel = selectionRef.current;
    let ids: string[];
    if (e.shiftKey) {
      // Shift-click: add or remove (PRD sel.shift_toggle).
      sel.toggle(id);
      ids = sel.ids.has(id) ? [...sel.ids].filter((x) => x !== id) : [...sel.ids, id];
    } else if (!sel.ids.has(id)) {
      // Dragging an unselected object selects only it (PRD
      // sel.drag_unselected).
      sel.click(id);
      ids = [id];
    } else {
      ids = [...sel.ids];
    }

    if (!canEditRef.current) return; // viewing only: no gesture

    gestureRef.current = {
      kind: 'object',
      phase: 'pressed',
      id,
      ids,
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startRects: null,
    };
    window.addEventListener('pointermove', onMoveRef.current);
    window.addEventListener('pointerup', onUpRef.current);
    window.addEventListener('pointercancel', onCancelRef.current);
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    if (e.button !== 0) return;
    if (gestureRef.current.kind !== 'idle') return;
    if (!canEditRef.current) return;
    const sel = selectionRef.current;
    if (sel.ids.size === 0) return;
    const ids = [...sel.ids];
    const resizable = ids.some((id) => specOf(typeOf(id) ?? '')?.resizable === true);
    if (!resizable) return;

    gestureRef.current = {
      kind: 'handle',
      phase: 'pressed',
      handle,
      ids,
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startRects: null,
      startBounds: null,
    };
    window.addEventListener('pointermove', onMoveRef.current);
    window.addEventListener('pointerup', onUpRef.current);
    window.addEventListener('pointercancel', onCancelRef.current);
  }, [typeOf]);

  // Clean up on unmount: drop any in-flight gesture and pending frame.
  useEffect(() => {
    return () => {
      detach();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onObjectPointerDown, onHandlePointerDown };
}
