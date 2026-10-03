/**
 * Generic transform gesture (story 7, sel.drag / sel.resize).
 *
 * One pointer-driven gesture for every object type: drag an object (or a
 * selection) to move it, drag a bounding-box handle to resize the selection.
 *
 * - A plain pointerdown on an unselected object first selects it alone
 *   (sel.drag_unselected); the gesture then moves the (new) selection.
 * - The gesture activates once the pointer crosses DRAG_THRESHOLD_PX; below
 *   the threshold a pointerup is a plain click with no writes.
 * - Writes are absolute (start + delta), rAF-throttled to one transaction per
 *   frame, and clamped so no object leaves the board (sel.size_limits) while
 *   the relative layout is preserved (sel.resize).
 * - A group move raises the selection above unselected objects once
 *   (sel.stacking); a resize keeps aspect when any selected type is
 *   aspect-locked or Shift is held (sel.aspect).
 */

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import {
  unionRects,
  resizeRect,
  clampScale,
  anchoredBox,
  scaleWithin,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Selection } from './useSelection';

type Gesture =
  | {
      kind: 'move';
      startScreen: Point;
      startWorld: Point;
      activated: boolean;
      /** id → starting world position. */
      starts: Map<string, Point>;
      ids: string[];
    }
  | {
      kind: 'resize';
      startScreen: Point;
      startWorld: Point;
      activated: boolean;
      startBox: Rect;
      handle: Handle;
      aspectLocked: boolean;
      /** Per-object starting bounds, aligned with `minSizes` and `ids`. */
      bounds: Rect[];
      minSizes: number[];
      ids: string[];
    };

export interface TransformGesture {
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  objects: readonly ObjectSnapshot[];
  selection: Selection;
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): TransformGesture {
  const { doc, camera, objects, selection } = opts;

  // Always-fresh refs so the window listeners never read stale state.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onStartRef = useRef(opts.onGestureStart);
  onStartRef.current = opts.onGestureStart;
  const onEndRef = useRef(opts.onGestureEnd);
  onEndRef.current = opts.onGestureEnd;

  const gestureRef = useRef<Gesture | null>(null);
  const pendingRef = useRef<{ write: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.write();
  }, []);

  const schedule = useCallback((write: () => void) => {
    pendingRef.current = { write };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        p?.write();
      });
    }
  }, []);

  // Clean up any in-flight frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const worldPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    return screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
  }, []);

  const screenPoint = (e: { clientX: number; clientY: number }): Point => ({
    x: e.clientX,
    y: e.clientY,
  });

  /** True once the pointer has crossed the drag threshold (screen space). */
  const pastThreshold = (g: Gesture, e: { clientX: number; clientY: number }): boolean => {
    const p = screenPoint(e);
    return Math.hypot(p.x - g.startScreen.x, p.y - g.startScreen.y) >= DRAG_THRESHOLD_PX;
  };

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0 || !canEditRef.current) return;
      const sel = selectionRef.current;
      const world = worldPoint(e);

      // Shift-click: toggle membership, no drag (sel.shift_toggle).
      if (e.shiftKey) {
        sel.toggle(id);
        return;
      }

      // A plain click selects this object alone unless it is already part of
      // the selection (then the whole selection moves) (sel.drag_unselected).
      let gestureIds: string[];
      if (sel.ids.has(id)) {
        gestureIds = [...sel.ids];
      } else {
        gestureIds = [id];
        sel.click(id);
      }

      const starts = new Map<string, Point>();
      for (const obj of objectsRef.current) {
        if (gestureIds.includes(obj.id)) starts.set(obj.id, { x: obj.x, y: obj.y });
      }

      gestureRef.current = {
        kind: 'move',
        startScreen: screenPoint(e),
        startWorld: world,
        activated: false,
        starts,
        ids: gestureIds,
      };
      onStartRef.current?.();

      const onMove = (ev: PointerEvent) => {
        const g = gestureRef.current;
        if (!g || g.kind !== 'move') return;
        if (!g.activated) {
          if (!pastThreshold(g, ev)) return;
          g.activated = true;
          // Raise the selection above unselected objects once (sel.stacking).
          bringObjectsToFront(doc, g.ids);
        }
        const w = worldPoint(ev);
        const dx = w.x - g.startWorld.x;
        const dy = w.y - g.startWorld.y;
        const positions = new Map<string, Point>();
        for (const [oid, start] of g.starts) {
          positions.set(oid, { x: start.x + dx, y: start.y + dy });
        }
        schedule(() => moveObjects(doc, positions));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        flush();
        gestureRef.current = null;
        onEndRef.current?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [doc, worldPoint, schedule, flush],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle) => {
      if (e.button !== 0 || !canEditRef.current) return;
      const sel = selectionRef.current;
      const world = worldPoint(e);
      const objs = objectsRef.current;

      const selected = objs.filter((o) => sel.ids.has(o.id));
      if (selected.length === 0) return;

      const startBox = unionRects(selected.map(objectBounds));
      if (!startBox) return;

      // Aspect-locked when any selected type is aspect-locked, or Shift is
      // held (sel.aspect, key decision 3).
      const aspectLocked =
        e.shiftKey || selected.some((o) => getObjectType(o.type)?.aspectLocked === true);
      const bounds = selected.map(objectBounds);
      const minSizes = selected.map((o) => getObjectType(o.type)?.minSize ?? 0);
      const ids = selected.map((o) => o.id);

      gestureRef.current = {
        kind: 'resize',
        startScreen: screenPoint(e),
        startWorld: world,
        activated: false,
        startBox,
        handle,
        aspectLocked,
        bounds,
        minSizes,
        ids,
      };
      onStartRef.current?.();

      const onMove = (ev: PointerEvent) => {
        const g = gestureRef.current;
        if (!g || g.kind !== 'resize') return;
        if (!g.activated) {
          if (!pastThreshold(g, ev)) return;
          g.activated = true;
        }
        const w = worldPoint(ev);
        const delta: Point = { x: w.x - g.startWorld.x, y: w.y - g.startWorld.y };
        const proposed = resizeRect(g.startBox, g.handle, delta, g.aspectLocked);
        const scale = {
          x: g.startBox.width > 0 ? proposed.width / g.startBox.width : 1,
          y: g.startBox.height > 0 ? proposed.height / g.startBox.height : 1,
        };
        const clamped = clampScale(scale, g.bounds, g.minSizes, MAX_OBJECT_SIZE_WORLD);
        const finalBox = anchoredBox(g.startBox, g.handle, clamped);
        const rects = new Map<string, Rect>();
        for (let i = 0; i < g.ids.length; i++) {
          rects.set(g.ids[i], scaleWithin(g.bounds[i], g.startBox, finalBox));
        }
        schedule(() => resizeObjects(doc, rects));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        flush();
        gestureRef.current = null;
        onEndRef.current?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [doc, worldPoint, schedule, flush],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
