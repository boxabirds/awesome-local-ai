import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
} from '../../shared/board-model';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';

/**
 * Story 7: the generic transform gesture (sel.transform).
 *
 * One press on an object starts a move once the pointer crosses
 * DRAG_THRESHOLD_PX screen pixels; one press on a resize handle resizes the
 * selection's bounding box. Both write absolute positions/rects through the
 * group operations, so concurrent editors converge. Writes are batched per
 * animation frame.
 */

export interface TransformGestureApi {
  /** Pointer down on an object: select (or shift-toggle), then potential move. */
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  /** Pointer down on a bounding-box handle: resize the selection. */
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

export interface TransformGestureDeps {
  doc: Y.Doc;
  camera: Camera;
  objects: readonly ObjectSnapshot[];
  canEdit: boolean;
  selection: {
    ids: ReadonlySet<string>;
    click: (id: string) => void;
    toggle: (id: string) => void;
  };
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

type GestureState =
  | {
      kind: 'move';
      pointerId: number;
      startScreen: Point;
      startWorld: Point;
      ids: Set<string>;
      startPositions: Map<string, Point>;
      started: boolean;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startScreen: Point;
      startWorld: Point;
      handle: Handle;
      startBox: Rect;
      startRects: Map<string, Rect>;
      minSizes: number[];
      aspectLocked: boolean;
    };

function screenDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function useTransformGesture(deps: TransformGestureDeps): TransformGestureApi {
  const stateRef = useRef<GestureState | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // Latest desired writes, batched per animation frame.
  const pendingMoveRef = useRef<Map<string, Point> | null>(null);
  const pendingResizeRef = useRef<Map<string, Rect> | null>(null);
  const rafRef = useRef(0);
  // The most recent pointer position, used to commit the exact final state on
  // pointer-up (independent of animation-frame timing, which Chromium throttles
  // in background contexts).
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const flush = useCallback(() => {
    const { doc } = depsRef.current;
    if (pendingMoveRef.current && pendingMoveRef.current.size > 0) {
      moveObjects(doc, pendingMoveRef.current);
      pendingMoveRef.current = null;
    }
    if (pendingResizeRef.current && pendingResizeRef.current.size > 0) {
      resizeObjects(doc, pendingResizeRef.current);
      pendingResizeRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      flush();
    });
  }, [flush]);

  // Stable window listeners (read state through refs).
  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onEndRef = useRef<(e: PointerEvent) => void>(() => {});

  const detach = useCallback(() => {
    window.removeEventListener('pointermove', onMoveRef.current);
    window.removeEventListener('pointerup', onEndRef.current);
    window.removeEventListener('pointercancel', onEndRef.current);
  }, []);

  const finishGesture = useCallback((endPos?: { clientX: number; clientY: number }) => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingMoveRef.current = null;
    pendingResizeRef.current = null;
    const st = stateRef.current;
    stateRef.current = null;
    detach();
    if (!st) return;
    // The pointer-up event's coordinates are the authoritative final position
    // (the last pointermove may be coalesced away by the browser).
    const last = endPos ?? lastPointerRef.current;
    lastPointerRef.current = null;
    const { doc, camera } = depsRef.current;
    if (last) {
      const startWorld = screenToWorld(camera, st.startScreen);
      const endWorld = screenToWorld(camera, { x: last.clientX, y: last.clientY });
      const delta: Point = { x: endWorld.x - startWorld.x, y: endWorld.y - startWorld.y };
      if (st.kind === 'move' && st.started) {
        const positions = new Map<string, Point>();
        for (const [id, p] of st.startPositions) {
          positions.set(id, { x: p.x + delta.x, y: p.y + delta.y });
        }
        moveObjects(doc, positions);
      } else if (st.kind === 'resize') {
        const proposed = resizeRect(st.startBox, st.handle, delta, st.aspectLocked);
        const gw = st.startBox.width > 0 ? st.startBox.width : 1;
        const gh = st.startBox.height > 0 ? st.startBox.height : 1;
        const scale = { x: proposed.width / gw, y: proposed.height / gh };
        const rectsArr = [...st.startRects.values()];
        const clamped = clampScale(scale, rectsArr, st.minSizes, MAX_OBJECT_SIZE_WORLD);
        let clampedBox: Rect;
        if (clamped.x === scale.x && clamped.y === scale.y) {
          clampedBox = proposed;
        } else {
          const width = st.startBox.width * clamped.x;
          const height = st.startBox.height * clamped.y;
          const growsRight = !st.handle.includes('w');
          const growsDown = !st.handle.includes('n');
          clampedBox = {
            x: growsRight ? st.startBox.x : st.startBox.x + st.startBox.width - width,
            y: growsDown ? st.startBox.y : st.startBox.y + st.startBox.height - height,
            width,
            height,
          };
        }
        const next = new Map<string, Rect>();
        for (const [id, r] of st.startRects) next.set(id, scaleWithin(r, st.startBox, clampedBox));
        resizeObjects(doc, next);
      }
    }
    if (st.kind === 'move' && st.started) depsRef.current.onGestureEnd?.();
    if (st.kind === 'resize') depsRef.current.onGestureEnd?.();
  }, [detach]);

  onMoveRef.current = (e: PointerEvent) => {
    const st = stateRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    const { camera } = depsRef.current;
    const curScreen: Point = { x: e.clientX, y: e.clientY };
    const curWorld = screenToWorld(camera, curScreen);

    if (st.kind === 'move') {
      if (!st.started) {
        if (screenDistance(st.startScreen, curScreen) < DRAG_THRESHOLD_PX) return;
        st.started = true;
        depsRef.current.onGestureStart?.();
        bringObjectsToFront(depsRef.current.doc, [...st.ids]);
      }
      const dx = curWorld.x - st.startWorld.x;
      const dy = curWorld.y - st.startWorld.y;
      const positions = new Map<string, Point>();
      for (const [id, p] of st.startPositions) {
        positions.set(id, { x: p.x + dx, y: p.y + dy });
      }
      pendingMoveRef.current = positions;
      scheduleFlush();
    } else {
      const delta: Point = {
        x: curWorld.x - st.startWorld.x,
        y: curWorld.y - st.startWorld.y,
      };
      const proposed = resizeRect(st.startBox, st.handle, delta, st.aspectLocked);
      const gw = st.startBox.width > 0 ? st.startBox.width : 1;
      const gh = st.startBox.height > 0 ? st.startBox.height : 1;
      const scale = { x: proposed.width / gw, y: proposed.height / gh };
      const rectsArr = [...st.startRects.values()];
      const clamped = clampScale(scale, rectsArr, st.minSizes, MAX_OBJECT_SIZE_WORLD);
      let clampedBox: Rect;
      if (clamped.x === scale.x && clamped.y === scale.y) {
        // No object hit a size limit: the proposed rect is exact.
        clampedBox = proposed;
      } else {
        const width = st.startBox.width * clamped.x;
        const height = st.startBox.height * clamped.y;
        const growsRight = !st.handle.includes('w');
        const growsDown = !st.handle.includes('n');
        clampedBox = {
          x: growsRight ? st.startBox.x : st.startBox.x + st.startBox.width - width,
          y: growsDown ? st.startBox.y : st.startBox.y + st.startBox.height - height,
          width,
          height,
        };
      }
      if (!pendingResizeRef.current) pendingResizeRef.current = new Map();
      for (const [id, r] of st.startRects) {
        pendingResizeRef.current.set(id, scaleWithin(r, st.startBox, clampedBox));
      }
      scheduleFlush();
    }
  };

  onEndRef.current = (e: PointerEvent) => {
    const st = stateRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    finishGesture({ clientX: e.clientX, clientY: e.clientY });
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      detach();
    };
  }, [detach]);

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      const { camera, objects, canEdit, selection } = depsRef.current;
      if (e.button !== 0) return;
      if (stateRef.current) return; // one gesture at a time
      if (e.shiftKey) {
        selection.toggle(id);
        return;
      }
      if (!selection.ids.has(id)) {
        selection.click(id);
      }
      if (!canEdit) return; // viewers: local selection only, no transforms

      const ids = new Set(selection.ids.has(id) ? selection.ids : [id]);
      const startPositions = new Map<string, Point>();
      for (const obj of objects) {
        if (ids.has(obj.id)) {
          startPositions.set(obj.id, { x: obj.x, y: obj.y });
        }
      }
      if (startPositions.size === 0) return;

      stateRef.current = {
        kind: 'move',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startWorld: screenToWorld(camera, { x: e.clientX, y: e.clientY }),
        ids,
        startPositions,
        started: false,
      };
      window.addEventListener('pointermove', onMoveRef.current);
      window.addEventListener('pointerup', onEndRef.current);
      window.addEventListener('pointercancel', onEndRef.current);
    },
    [],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerEvent, handle: Handle) => {
      const { camera, objects, canEdit, selection } = depsRef.current;
      if (e.button !== 0) return;
      if (!canEdit) return;
      if (stateRef.current) return;
      if (selection.ids.size === 0) return;

      // Only objects of resizable types are resized.
      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      let anyAspectLocked = false;
      for (const obj of objects) {
        if (!selection.ids.has(obj.id)) continue;
        const spec = getObjectType(obj.type);
        if (!spec || !spec.resizable) continue;
        startRects.set(obj.id, objectBounds(obj));
        minSizes.push(spec.minSize);
        if (spec.aspectLocked) anyAspectLocked = true;
      }
      if (startRects.size === 0) return;
      const box = unionRects([...startRects.values()]);
      if (!box) return;

      stateRef.current = {
        kind: 'resize',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startWorld: screenToWorld(camera, { x: e.clientX, y: e.clientY }),
        handle,
        startBox: box,
        startRects,
        minSizes,
        aspectLocked: anyAspectLocked || e.shiftKey,
      };
      depsRef.current.onGestureStart?.();
      window.addEventListener('pointermove', onMoveRef.current);
      window.addEventListener('pointerup', onEndRef.current);
      window.addEventListener('pointercancel', onEndRef.current);
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
