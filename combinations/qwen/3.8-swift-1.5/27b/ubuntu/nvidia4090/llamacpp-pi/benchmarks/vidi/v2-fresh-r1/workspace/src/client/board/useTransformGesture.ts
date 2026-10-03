// Shared transform gesture: move and resize the current selection (story 7).
//
// State machine:
//   idle → pressed  : pointerdown on an object (selects it) or a resize handle
//   pressed → moving   : move past DRAG_THRESHOLD_PX (capture start rects,
//                        bring selection to front, onGestureStart)
//   pressed → resizing : move past DRAG_THRESHOLD_PX on a handle (onGestureStart)
//   moving/resizing → idle : pointerup / pointercancel (flush, onGestureEnd)
//
// Mutations are throttled with requestAnimationFrame: at most one
// moveObjects/resizeObjects call per frame, and the final position is always
// applied on release (flush).

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
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
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { setTextWidthFixed } from '../../shared/objects/text';
import type { Camera } from '../canvas/camera';
import type { SelectionApi } from './useSelection';

interface GestureState {
  mode: 'idle' | 'pressed' | 'moving' | 'resizing';
  pointerId: number;
  startScreen: Point;
  /** The selection at gesture start (frozen: the gesture moves these ids). */
  gestureIds: string[];
  /** id → world rect at gesture start (captured once past threshold). */
  startRects: Map<string, Rect>;
  /** id → min size in world units (parallel to startRects insertion order). */
  minSizes: Map<string, number>;
  startBox: Rect | null;
  handle: Handle | null;
  aspectLocked: boolean;
  /**
   * Story 9: a lone text object dragged by e/w resizes its width only
   * (height is re-derived by the box-sync hook).
   */
  widthDrag: { id: string; startRect: Rect; handle: 'e' | 'w' } | null;
}

const IDLE: GestureState = {
  mode: 'idle',
  pointerId: -1,
  startScreen: { x: 0, y: 0 },
  gestureIds: [],
  startRects: new Map(),
  minSizes: new Map(),
  startBox: null,
  handle: null,
  aspectLocked: false,
  widthDrag: null,
};

export interface TransformGesture {
  onObjectPointerDown: (e: ReactPointerEvent<Element>, id: string) => void;
  onHandlePointerDown: (e: ReactPointerEvent<Element>, handle: Handle) => void;
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}): TransformGesture {
  const { doc, camera, selection, snapshot, canEdit } = opts;

  // Latest values, read inside window listeners (never effect deps).
  const docRef = useRef(doc);
  docRef.current = doc;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stateRef = useRef<GestureState>(IDLE);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  // --- rAF-throttled mutation application ---

  const schedule = useCallback((fn: () => void) => {
    pendingRef.current = fn;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const apply = pendingRef.current;
        pendingRef.current = null;
        apply?.();
      });
    }
  }, []);

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const apply = pendingRef.current;
    pendingRef.current = null;
    apply?.();
  }, []);

  // --- window listeners (one set for the whole hook lifetime) ---

  useEffect(() => {
    const captureStartRects = (ids: readonly string[]): Map<string, Rect> => {
      const rects = new Map<string, Rect>();
      const minSizes = new Map<string, number>();
      const idSet = new Set(ids);
      for (const o of snapshotRef.current) {
        if (!idSet.has(o.id)) continue;
        rects.set(o.id, objectBounds(o));
        minSizes.set(o.id, getObjectType(o.type)?.minSize ?? 0);
      }
      stateRef.current.minSizes = minSizes;
      return rects;
    };

    const onMove = (e: PointerEvent) => {
      const st = stateRef.current;
      if (st.mode !== 'pressed' && st.mode !== 'moving' && st.mode !== 'resizing') return;
      if (e.pointerId !== st.pointerId) return;

      const cam = cameraRef.current;
      const dx = e.clientX - st.startScreen.x;
      const dy = e.clientY - st.startScreen.y;
      const dist = Math.hypot(dx, dy);

      if (st.mode === 'pressed') {
        if (dist < DRAG_THRESHOLD_PX) return;
        if (st.handle !== null) {
          st.mode = 'resizing';
          optsRef.current.onGestureStart?.();
        } else {
          st.startRects = captureStartRects(st.gestureIds);
          st.mode = 'moving';
          optsRef.current.onGestureStart?.();
          bringObjectsToFront(docRef.current, st.gestureIds);
        }
      }

      const wx = dx / cam.zoom;
      const wy = dy / cam.zoom;

      if (st.mode === 'moving') {
        const positions = new Map<string, Point>();
        for (const [id, r] of st.startRects) {
          positions.set(id, { x: r.x + wx, y: r.y + wy });
        }
        schedule(() => moveObjects(docRef.current, positions));
      } else if (st.mode === 'resizing' && st.widthDrag !== null) {
        const { id, startRect, handle } = st.widthDrag;
        const raw = handle === 'e' ? startRect.width + wx : startRect.width - wx;
        const clamped = Math.min(Math.max(raw, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
        const x = handle === 'w' ? startRect.x + (startRect.width - clamped) : startRect.x;
        schedule(() => setTextWidthFixed(docRef.current, id, clamped, x));
      } else if (st.mode === 'resizing' && st.startBox !== null) {
        const box = st.startBox;
        const handle = st.handle!;
        const aspectLocked = st.aspectLocked || e.shiftKey;
        const newBox = resizeRect(box, handle, { x: wx, y: wy }, aspectLocked);
        const scale = {
          x: box.width !== 0 ? newBox.width / box.width : 1,
          y: box.height !== 0 ? newBox.height / box.height : 1,
        };
        const clamped = clampScale(
          scale,
          [...st.startRects.values()],
          [...st.minSizes.values()],
          MAX_OBJECT_SIZE_WORLD,
        );
        const finalBox: Rect = {
          x: box.x,
          y: box.y,
          width: box.width * clamped.x,
          height: box.height * clamped.y,
        };
        const rects = new Map<string, Rect>();
        for (const [id, r] of st.startRects) {
          rects.set(id, scaleWithin(r, box, finalBox));
        }
        schedule(() => resizeObjects(docRef.current, rects));
      }
    };

    const finish = (e: PointerEvent) => {
      const st = stateRef.current;
      if (st.mode === 'idle' || e.pointerId !== st.pointerId) return;
      if (st.mode === 'moving' || st.mode === 'resizing') {
        flush(); // apply the final position exactly
        optsRef.current.onGestureEnd?.();
      }
      stateRef.current = IDLE;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
    };
  }, [schedule, flush]);

  // --- entry points ---

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<Element>, id: string) => {
      if (e.button !== 0) return;
      if (stateRef.current.mode !== 'idle') return;
      // Selecting works even when editing is locked (viewing).
      const wasSelected = selectionRef.current.ids.has(id);
      if (!wasSelected) {
        selectionRef.current.click(id);
      }
      if (!canEditRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      // Freeze the selection for this gesture: dragging a selected object
      // moves the whole (committed) selection; dragging an unselected one
      // selects and moves just it. (The click dispatch may not have rendered
      // yet, so do not read the selection back from state.)
      const gestureIds = wasSelected ? [...selectionRef.current.ids] : [id];
      stateRef.current = {
        ...IDLE,
        mode: 'pressed',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        gestureIds,
      };
    },
    [],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, handle: Handle) => {
      if (e.button !== 0) return;
      if (stateRef.current.mode !== 'idle') return;
      if (!canEditRef.current) return;
      const ids = selectionRef.current.ids;
      if (ids.size === 0) return;
      const selected = snapshotRef.current.filter((o) => ids.has(o.id));
      if (selected.length === 0) return;
      if (!selected.some((o) => getObjectType(o.type)?.resizable)) return;

      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const startRects = new Map<string, Rect>();
      const minSizes = new Map<string, number>();
      for (const o of selected) {
        startRects.set(o.id, objectBounds(o));
        minSizes.set(o.id, getObjectType(o.type)?.minSize ?? 0);
      }
      const box = unionRects([...startRects.values()]);
      if (box === null) return;
      const aspectLocked = selected.some((o) => getObjectType(o.type)?.aspectLocked);

      // Story 9: a lone text object with an e/w handle → width-only drag.
      let widthDrag: GestureState['widthDrag'] = null;
      if (
        selected.length === 1 &&
        getObjectType(selected[0].type)?.handles === 'horizontal' &&
        (handle === 'e' || handle === 'w')
      ) {
        widthDrag = { id: selected[0].id, startRect: startRects.get(selected[0].id)!, handle };
      }

      stateRef.current = {
        mode: 'pressed',
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        gestureIds: [...ids],
        startRects,
        minSizes,
        startBox: box,
        handle,
        aspectLocked,
        widthDrag,
      };
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
