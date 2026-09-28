/**
 * Generic transform gesture: group move and bounding-box resize (story 7,
 * sel.transform). One hook serves every object type (PRD sel.all_types): object
 * presses move the whole selection, handle presses resize it.
 *
 * Key decisions honoured here:
 *  - Absolute writes from gesture start: each frame writes `start + delta` (or
 *    the scaled rect), never an accumulating delta, so concurrent remote edits
 *    converge to the last writer identically on every screen.
 *  - Group resize scale is clamped once (clampScale) against each type's minSize
 *    and MAX_OBJECT_SIZE_WORLD, then applied uniformly, so the layout never
 *    distorts as objects stop at different times.
 */
import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import {
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import type { SelectionApi } from './useSelection';
import { getObjectType } from '../objects/registry';

export interface TransformGesture {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
}

type Mode = 'idle' | 'pressed-object' | 'moving' | 'pressed-handle' | 'resizing';

interface GestureState {
  mode: Mode;
  pointerId: number | null;
  startScreen: Point;
  ids: string[];
  startPositions: Map<string, Point>;
  startRects: Map<string, Rect>;
  minSizes: number[];
  startBox: Rect | null;
  handle: Handle;
  aspect: boolean;
  started: boolean;
  allHorizontal: boolean;
  raf: number | null;
  pending: (() => void) | null;
}

function initialState(): GestureState {
  return {
    mode: 'idle',
    pointerId: null,
    startScreen: { x: 0, y: 0 },
    ids: [],
    startPositions: new Map(),
    startRects: new Map(),
    minSizes: [],
    startBox: null,
    handle: 'se',
    aspect: false,
    started: false,
    allHorizontal: false,
    raf: null,
    pending: null,
  };
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  getCamera: () => Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): TransformGesture {
  const { doc, getCamera } = opts;

  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const startCbRef = useRef(opts.onGestureStart);
  startCbRef.current = opts.onGestureStart;
  const endCbRef = useRef(opts.onGestureEnd);
  endCbRef.current = opts.onGestureEnd;

  const s = useRef<GestureState>(initialState());

  const schedule = useCallback((write: () => void) => {
    s.current.pending = write;
    if (s.current.raf === null && typeof requestAnimationFrame === 'function') {
      s.current.raf = requestAnimationFrame(() => {
        s.current.raf = null;
        const fn = s.current.pending;
        s.current.pending = null;
        fn?.();
      });
    } else if (s.current.raf === null) {
      const fn = s.current.pending;
      s.current.pending = null;
      fn?.();
    }
  }, []);

  const flush = useCallback(() => {
    if (s.current.raf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(s.current.raf);
    }
    s.current.raf = null;
    const fn = s.current.pending;
    s.current.pending = null;
    fn?.();
  }, []);

  const handleMove = useCallback(
    (e: PointerEvent) => {
      const st = s.current;
      if (st.pointerId !== null && e.pointerId !== st.pointerId) return;
      const cam = getCamera();
      const dx = e.clientX - st.startScreen.x;
      const dy = e.clientY - st.startScreen.y;
      const dist = Math.hypot(dx, dy);

      if (!st.started) {
        if (dist < DRAG_THRESHOLD_PX) return;
        st.started = true;
        startCbRef.current?.();
        if (st.mode === 'pressed-object') st.mode = 'moving';
        else if (st.mode === 'pressed-handle') st.mode = 'resizing';
        if (st.mode === 'moving' && canEditRef.current) {
          bringObjectsToFront(doc, st.ids);
        }
      }

      if (st.mode === 'moving') {
        if (!canEditRef.current) return;
        const wx = dx / cam.zoom;
        const wy = dy / cam.zoom;
        const positions = new Map<string, Point>();
        st.startPositions.forEach((p, id) => positions.set(id, { x: p.x + wx, y: p.y + wy }));
        if (positions.size === 0) return;
        schedule(() => moveObjects(doc, positions));
      } else if (st.mode === 'resizing') {
        if (!canEditRef.current) return;
        const startBox = st.startBox;
        if (!startBox) return;
        const wx = dx / cam.zoom;
        const wy = dy / cam.zoom;
        const to = resizeRect(startBox, st.handle, { x: wx, y: wy }, st.aspect);
        const scaleX = startBox.width > 0 ? to.width / startBox.width : 1;
        const scaleY = startBox.height > 0 ? to.height / startBox.height : 1;
        const rects: Rect[] = [];
        st.startRects.forEach((r) => rects.push(r));
        const clamped = clampScale(
          { x: scaleX, y: scaleY },
          rects,
          st.minSizes,
          MAX_OBJECT_SIZE_WORLD,
        );
        const anchored = anchoredRect(startBox, st.handle, clamped.x, clamped.y);
        const updates = new Map<string, Rect>();
        st.startRects.forEach((r, id) => updates.set(id, scaleWithin(r, startBox, anchored)));
        if (updates.size === 0) return;
        schedule(() => resizeObjects(doc, updates));
      }
    },
    [doc, getCamera, schedule],
  );

  const handleUp = useCallback(() => {
    flush();
    const st = s.current;
    if (st.started) {
      // Story 9: after a horizontal resize, set text objects to fixed-width mode
      if (st.mode === 'resizing' && (st.handle === 'e' || st.handle === 'w') && st.allHorizontal) {
        const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
        for (const id of st.ids) {
          const obj = objectsMap.get(id);
          if (obj && obj.get('type') === 'text') {
            const newWidth = obj.get('width') as number | undefined;
            if (newWidth != null) setTextWidthFixed(doc, id, newWidth);
          }
        }
      }
      st.started = false;
      endCbRef.current?.();
    }
    s.current = initialState();
    detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, doc]);

  // Stable window-listener identity that always dispatches to the latest logic.
  const moveListener = useRef((e: PointerEvent) => handleMove(e)).current;
  const upListener = useRef(() => handleUp()).current;

  function attach(): void {
    window.addEventListener('pointermove', moveListener);
    window.addEventListener('pointerup', upListener);
    window.addEventListener('pointercancel', upListener);
  }
  function detach(): void {
    window.removeEventListener('pointermove', moveListener);
    window.removeEventListener('pointerup', upListener);
    window.removeEventListener('pointercancel', upListener);
  }

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent, id: string) => {
      e.stopPropagation();
      if (e.button !== undefined && e.button !== 0) return;
      // A read-only board does not select or move objects at all (story 4 gate).
      if (!canEditRef.current) return;

      if (e.shiftKey) {
        selectionRef.current.toggle(id);
        return;
      }
      if (!selectionRef.current.ids.has(id)) selectionRef.current.click(id);
      const idsForGesture = selectionRef.current.ids.has(id)
        ? [...selectionRef.current.ids]
        : [id];

      const st = s.current;
      st.mode = 'pressed-object';
      st.pointerId = e.pointerId;
      st.startScreen = { x: e.clientX, y: e.clientY };
      st.ids = idsForGesture;
      st.started = false;
      captureRectsInto(st, idsForGesture, snapshotRef.current);
      attach();
    },
    // attach/detach are stable (defined in render closure with stable listeners)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: Handle) => {
      e.stopPropagation();
      if (e.button !== undefined && e.button !== 0) return;
      if (!canEditRef.current) return;
      const ids = [...selectionRef.current.ids];
      if (ids.length === 0) return;

      const byId = snapshotRef.current;
      let anyResizable = false;
      let allHorizontal = true;
      let aspect = e.shiftKey;
      const minSizes: number[] = [];
      const rects: Rect[] = [];
      const startRects = new Map<string, Rect>();
      for (const id of ids) {
        const obj = byId.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (!obj || !spec) continue;
        if (spec.resizable) anyResizable = true;
        if (spec.handles !== 'horizontal') allHorizontal = false;
        if (spec.aspectLocked) aspect = true;
        minSizes.push(spec.minSize);
        const r = objectBounds(obj);
        rects.push(r);
        startRects.set(id, r);
      }
      if (!anyResizable) return;
      const startBox = unionRects(rects);
      if (!startBox) return;

      const st = s.current;
      st.mode = 'pressed-handle';
      st.pointerId = e.pointerId;
      st.startScreen = { x: e.clientX, y: e.clientY };
      st.ids = ids;
      st.startRects = startRects;
      st.minSizes = minSizes;
      st.startBox = startBox;
      st.handle = handle;
      st.aspect = aspect;
      st.allHorizontal = allHorizontal;
      st.started = false;
      attach();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}

function captureRectsInto(
  st: GestureState,
  ids: string[],
  snapshot: readonly ObjectSnapshot[],
): void {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const positions = new Map<string, Point>();
  const rects = new Map<string, Rect>();
  for (const id of ids) {
    const obj = byId.get(id);
    if (!obj) continue;
    positions.set(id, { x: obj.x, y: obj.y });
    rects.set(id, objectBounds(obj));
  }
  st.startPositions = positions;
  st.startRects = rects;
}

/** Bounding box of size start.w*scaleX × start.h*scaleY, anchored opposite the handle. */
function anchoredRect(start: Rect, handle: Handle, scaleX: number, scaleY: number): Rect {
  const width = start.width * scaleX;
  const height = start.height * scaleY;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const dragLeft = handle === 'w' || handle === 'nw' || handle === 'sw';
  const dragTop = handle === 'n' || handle === 'nw' || handle === 'ne';
  const x = dragLeft ? right - width : start.x;
  const y = dragTop ? bottom - height : start.y;
  return { x, y, width, height };
}
