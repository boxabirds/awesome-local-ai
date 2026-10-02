import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '../../shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Rect,
  type Handle,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

interface GestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

interface ActiveGesture {
  kind: 'object' | 'handle';
  el: Element;
  pointerId: number;
  startScreen: Point;
  lastScreen: Point;
  moved: boolean;
  rafId: number;
  handle: Handle | null;
  /** Shift held during the gesture (aspect lock for resize). */
  shiftKey: boolean;
  /** Object bounds captured when the drag threshold was crossed. */
  startRects: Map<string, Rect> | null;
  /** The bounding box captured when the drag threshold was crossed. */
  startBox: Rect | null;
  onMove: (ev: PointerEvent) => void;
  onUp: () => void;
  onCancel: () => void;
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * The generic object transform gesture (story 7, sel.move / sel.resize):
 *
 * - `onObjectPointerDown(e, id)`: selects `id` (single click), then starts a
 *   potential drag. A move below DRAG_THRESHOLD_PX is a plain click (no
 *   transaction); at the threshold the group move begins — the current
 *   selection's bounds are captured, `onGestureStart` fires once, the
 *   selection is raised, and every move writes ONE moveObjects transaction
 *   (rAF-throttled) moving all selected objects by the total world delta.
 *
 * - `onHandlePointerDown(e, handle)`: starts a potential resize of the
 *   selection's bounding box: resizeRect (aspect-locked when the selection
 *   contains an aspect-locked type or Shift is held), clampScale against the
 *   per-object min sizes and the global max, then scaleWithin maps every
 *   object into the new box — ONE resizeObjects transaction per move.
 *
 * Pointercancel keeps the last-applied position and fires `onGestureEnd`
 * once. Non-finite positions never reach a transaction.
 */
export function useTransformGesture(opts: GestureOptions) {
  const { selection, onGestureStart, onGestureEnd } = opts;
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const startRef = useRef(onGestureStart);
  startRef.current = onGestureStart;
  const endRef = useRef(onGestureEnd);
  endRef.current = onGestureEnd;
  const gestureRef = useRef<ActiveGesture | null>(null);

  const snapshotById = useCallback((): Map<string, ObjectSnapshot> => {
    const m = new Map<string, ObjectSnapshot>();
    for (const o of snapshotRef.current) m.set(o.id, o);
    return m;
  }, []);

  const captureStartRects = useCallback(() => {
    const byId = snapshotById();
    const rects = new Map<string, Rect>();
    for (const id of selectionRef.current.ids) {
      const o = byId.get(id);
      if (o) rects.set(id, objectBounds(o));
    }
    return rects;
  }, [snapshotById]);

  const applyMove = useCallback(() => {
    const g = gestureRef.current;
    if (!g || !g.startRects) return;
    const zoom = cameraRef.current.zoom;
    const dx = (g.lastScreen.x - g.startScreen.x) / zoom;
    const dy = (g.lastScreen.y - g.startScreen.y) / zoom;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const positions = new Map<string, Point>();
    for (const [id, r] of g.startRects) {
      positions.set(id, { x: r.x + dx, y: r.y + dy });
    }
    moveObjects(docRef.current, positions);
  }, []);

  const applyResize = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.handle === null || !g.startBox || !g.startRects) return;
    const zoom = cameraRef.current.zoom;
    const dx = (g.lastScreen.x - g.startScreen.x) / zoom;
    const dy = (g.lastScreen.y - g.startScreen.y) / zoom;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

    const byId = snapshotById();
    const ids = [...g.startRects.keys()];

    // Aspect lock: Shift, or any selected object whose type keeps proportions.
    let aspect = g.shiftKey;
    if (!aspect) {
      for (const id of ids) {
        if (getObjectType(byId.get(id)?.type ?? '')?.aspectLocked) {
          aspect = true;
          break;
        }
      }
    }

    const box = resizeRect(g.startBox, g.handle, { x: dx, y: dy }, aspect);
    const scale = {
      x: g.startBox.width !== 0 ? box.width / g.startBox.width : 1,
      y: g.startBox.height !== 0 ? box.height / g.startBox.height : 1,
    };
    const minSizes = ids.map((id) => getObjectType(byId.get(id)?.type ?? '')?.minSize ?? 0);
    const clamped = clampScale(scale, [...g.startRects.values()], minSizes, MAX_OBJECT_SIZE_WORLD);
    const w = g.startBox.width * clamped.x;
    const h = g.startBox.height * clamped.y;
    const anchorX =
      g.handle === 'w' || g.handle === 'nw' || g.handle === 'sw'
        ? g.startBox.x + g.startBox.width - w
        : g.startBox.x;
    const anchorY =
      g.handle === 'n' || g.handle === 'ne' || g.handle === 'nw'
        ? g.startBox.y + g.startBox.height - h
        : g.startBox.y;
    const target = { x: anchorX, y: anchorY, width: w, height: h };
    if (!finitePoint(target) || !Number.isFinite(target.width) || !Number.isFinite(target.height)) {
      return;
    }

    const rects = new Map<string, Rect>();
    for (const [id, r] of g.startRects) {
      rects.set(id, scaleWithin(r, g.startBox, target));
    }
    resizeObjects(docRef.current, rects);
  }, [snapshotById]);

  // schedule the pending apply on the next animation frame (rAF throttling).
  const schedule = useCallback(
    (apply: () => void) => {
      const g = gestureRef.current;
      if (!g) return;
      if (g.rafId !== 0) cancelAnimationFrame(g.rafId);
      g.rafId = requestAnimationFrame(apply);
    },
    [],
  );

  const detach = useCallback((g: ActiveGesture) => {
    if (g.rafId !== 0) cancelAnimationFrame(g.rafId);
    g.el.removeEventListener('pointermove', g.onMove as EventListener);
    g.el.removeEventListener('pointerup', g.onUp as EventListener);
    g.el.removeEventListener('pointercancel', g.onCancel as EventListener);
    if (g.el.hasPointerCapture?.(g.pointerId)) {
      g.el.releasePointerCapture(g.pointerId);
    }
  }, []);

  const finish = useCallback(
    (applyFinal: boolean) => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      if (g.moved) {
        if (g.rafId !== 0) {
          cancelAnimationFrame(g.rafId);
          g.rafId = 0;
          if (applyFinal) {
            if (g.kind === 'object') applyMove();
            else applyResize();
          }
        }
        endRef.current?.();
      }
      detach(g);
    },
    [applyMove, applyResize, detach],
  );

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (e.button !== 0) return;
      if (gestureRef.current) return;
      const sel = selectionRef.current;
      if (!sel.ids.has(id)) sel.click(id);
      // While any object is being edited, pointerdowns on objects do not
      // start a drag (the editor owns the pointer; PRD sticky.editor).
      if (sel.editingId !== null) return;
      if (!canEditRef.current) return;
      const el = (e.target as Element) ?? null;
      if (!el || typeof el.setPointerCapture !== 'function') return;
      el.setPointerCapture(e.pointerId);
      const g: ActiveGesture = {
        kind: 'object',
        el,
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        lastScreen: { x: e.clientX, y: e.clientY },
        moved: false,
        rafId: 0,
        handle: null,
        shiftKey: e.shiftKey,
        startRects: null,
        startBox: null,
        onMove: (ev) => {
          const cur = gestureRef.current;
          if (!cur || cur.kind !== 'object') return;
          cur.lastScreen = { x: ev.clientX, y: ev.clientY };
          if (!cur.moved) {
            const dist = Math.hypot(
              ev.clientX - cur.startScreen.x,
              ev.clientY - cur.startScreen.y,
            );
            if (dist < DRAG_THRESHOLD_PX) return;
            cur.moved = true;
            cur.startRects = captureStartRects();
            if (cur.startRects.size > 0) {
              bringObjectsToFront(docRef.current, [...cur.startRects.keys()]);
              startRef.current?.();
            }
          }
          schedule(applyMove);
        },
        onUp: () => finish(true),
        onCancel: () => finish(false),
      };
      gestureRef.current = g;
      el.addEventListener('pointermove', g.onMove as EventListener);
      el.addEventListener('pointerup', g.onUp as EventListener);
      el.addEventListener('pointercancel', g.onCancel as EventListener);
    },
    [captureStartRects, finish, schedule, applyMove],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      if (e.button !== 0) return;
      if (gestureRef.current) return;
      if (!canEditRef.current) return;
      const byId = snapshotById();
      const sel = selectionRef.current;
      const selectedObjs: ObjectSnapshot[] = [];
      for (const id of sel.ids) {
        const o = byId.get(id);
        if (o && getObjectType(o.type)?.resizable) selectedObjs.push(o);
      }
      if (selectedObjs.length === 0) return;
      e.stopPropagation();
      const el = (e.target as Element) ?? null;
      if (!el || typeof el.setPointerCapture !== 'function') return;
      el.setPointerCapture(e.pointerId);
      const g: ActiveGesture = {
        kind: 'handle',
        el,
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        lastScreen: { x: e.clientX, y: e.clientY },
        moved: false,
        rafId: 0,
        handle,
        shiftKey: e.shiftKey,
        startRects: null,
        startBox: null,
        onMove: (ev) => {
          const cur = gestureRef.current;
          if (!cur || cur.kind !== 'handle') return;
          cur.lastScreen = { x: ev.clientX, y: ev.clientY };
          cur.shiftKey = ev.shiftKey;
          if (!cur.moved) {
            const dist = Math.hypot(
              ev.clientX - cur.startScreen.x,
              ev.clientY - cur.startScreen.y,
            );
            if (dist < DRAG_THRESHOLD_PX) return;
            cur.moved = true;
            cur.startRects = captureStartRects();
            cur.startBox = unionRects([...(cur.startRects?.values() ?? [])]);
            if (cur.startBox && cur.startRects && cur.startRects.size > 0) {
              startRef.current?.();
            }
          }
          schedule(applyResize);
        },
        onUp: () => finish(true),
        onCancel: () => finish(false),
      };
      gestureRef.current = g;
      el.addEventListener('pointermove', g.onMove as EventListener);
      el.addEventListener('pointerup', g.onUp as EventListener);
      el.addEventListener('pointercancel', g.onCancel as EventListener);
    },
    [applyResize, captureStartRects, finish, schedule, snapshotById],
  );

  // Release any gesture on unmount.
  useEffect(() => {
    return () => {
      const g = gestureRef.current;
      if (g) {
        if (g.rafId !== 0) cancelAnimationFrame(g.rafId);
        g.el.removeEventListener('pointermove', g.onMove as EventListener);
        g.el.removeEventListener('pointerup', g.onUp as EventListener);
        g.el.removeEventListener('pointercancel', g.onCancel as EventListener);
        gestureRef.current = null;
      }
    };
  }, []);

  return { onObjectPointerDown, onHandlePointerDown };
}
