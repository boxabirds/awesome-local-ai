import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import type { Selection } from './useSelection';
import {
  objectBounds,
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  boxFromAnchor,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';

/**
 * Generic transform gesture (story 7, sel.move + sel.resize + sel.drag).
 *
 * Object pointerdown:
 *  - unselected object → it becomes the sole selection, then a drag moves it;
 *  - shift-click → toggle in/out of the selection (no drag);
 *  - movement below DRAG_THRESHOLD_PX is a click (no write).
 *
 * Handle pointerdown (from the SelectionOverlay): a drag resizes the whole
 * selection, anchored on the fixed corner/edge of the bounding box.
 *
 * Writes are absolute (`moveObjects`/`resizeObjects`), rAF-throttled, in one
 * LOCAL_ORIGIN transaction per event — the story 2 conflict pattern.
 *
 * Contract:
 *  - `onGestureStart`/`onGestureEnd` fire exactly once per drag (never for
 *    sub-threshold clicks); `onGestureEnd` also fires after pointercancel.
 *  - pointercancel mid-drag keeps the last applied position (no new write).
 *  - rejected when `canEdit` is false (load failure) — no writes, no callbacks.
 */
export interface TransformGesture {
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

interface GestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

type Press =
  | { kind: 'object'; id: string; startScreen: Point }
  | { kind: 'handle'; handle: Handle; startScreen: Point };

type ActiveGesture =
  | {
      kind: 'move';
      ids: string[];
      startRects: Map<string, Rect>;
      startScreen: Point;
    }
  | {
      kind: 'resize';
      ids: string[];
      startRects: Map<string, Rect>;
      startBox: Rect;
      handle: Handle;
      startScreen: Point;
      baseAspectLocked: boolean;
      minSizes: number[];
    };

export function useTransformGesture(options: GestureOptions): TransformGesture {
  const optsRef = useRef(options);
  optsRef.current = options;

  const pressRef = useRef<Press | null>(null);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const lastScreenRef = useRef<Point | null>(null);
  const rafRef = useRef(0);
  const shiftRef = useRef(false);

  const applyGesture = (g: ActiveGesture, screen: Point) => {
    const { doc, camera } = optsRef.current;
    const dx = (screen.x - g.startScreen.x) / camera.zoom;
    const dy = (screen.y - g.startScreen.y) / camera.zoom;

    if (g.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, r] of g.startRects) positions.set(id, { x: r.x + dx, y: r.y + dy });
      moveObjects(doc, positions);
      return;
    }

    // Resize: derive the proposed box, clamp, then scale every object within.
    const aspectLocked = g.baseAspectLocked || shiftRef.current;
    const proposed = resizeRect(g.startBox, g.handle, { x: dx, y: dy }, aspectLocked);
    let sx = g.startBox.width > 0 ? proposed.width / g.startBox.width : 1;
    let sy = g.startBox.height > 0 ? proposed.height / g.startBox.height : 1;
    // Non-finite proposed sizes (degenerate start) → treat as no change.
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      sx = 1;
      sy = 1;
    }
    const rects = [...g.startRects.values()];
    const clamped = clampScale({ x: sx, y: sy }, rects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
    const finalBox = boxFromAnchor(
      g.startBox,
      g.handle,
      g.startBox.width * clamped.x,
      g.startBox.height * clamped.y,
    );
    const newRects = new Map<string, Rect>();
    for (const [id, r] of g.startRects) newRects.set(id, scaleWithin(r, g.startBox, finalBox));
    resizeObjects(doc, newRects);
  };

  const startGesture = (press: Press, _e: PointerEvent) => {
    const { doc, selection, snapshot } = optsRef.current;
    // The delta is measured from the pointerdown position, not from the first
    // move event that crossed the threshold.
    const startScreen = press.startScreen;

    if (press.kind === 'object') {
      const ids = selection.ids.has(press.id) ? [...selection.ids] : [press.id];
      const startRects = new Map<string, Rect>();
      for (const o of snapshot) {
        if (ids.includes(o.id)) startRects.set(o.id, objectBounds(o));
      }
      if (startRects.size === 0) {
        pressRef.current = null;
        return;
      }
      bringObjectsToFront(doc, ids);
      optsRef.current.onGestureStart?.();
      gestureRef.current = { kind: 'move', ids: [...startRects.keys()], startRects, startScreen };
      applyGesture(gestureRef.current, startScreen);
      return;
    }

    // Handle press: resize the whole selection.
    const selected = snapshot.filter((o) => selection.ids.has(o.id));
    if (selected.length === 0) {
      pressRef.current = null;
      return;
    }
    const startBox = unionRects(selected.map(objectBounds));
    if (!startBox) {
      pressRef.current = null;
      return;
    }
    const startRects = new Map<string, Rect>();
    const minSizes: number[] = [];
    let baseAspectLocked = false;
    for (const o of selected) {
      const spec = getObjectType(o.type);
      startRects.set(o.id, objectBounds(o));
      minSizes.push(spec?.minSize ?? 0);
      if (spec?.aspectLocked) baseAspectLocked = true;
    }
    optsRef.current.onGestureStart?.();
    gestureRef.current = {
      kind: 'resize',
      ids: [...startRects.keys()],
      startRects,
      startBox,
      handle: press.handle,
      startScreen,
      baseAspectLocked,
      minSizes,
    };
    applyGesture(gestureRef.current, startScreen);
  };

  const onObjectPointerDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    if (!optsRef.current.canEdit) return;
    if (pressRef.current !== null || gestureRef.current !== null) return;
    const { selection } = optsRef.current;
    if (e.shiftKey) {
      selection.toggle(id);
      return;
    }
    if (!selection.ids.has(id)) selection.click(id);
    pressRef.current = { kind: 'object', id, startScreen: { x: e.clientX, y: e.clientY } };
    capturePointer(e);
  };

  const onHandlePointerDown = (e: PointerEvent, handle: Handle) => {
    if (e.button !== 0) return;
    if (!optsRef.current.canEdit) return;
    if (pressRef.current !== null || gestureRef.current !== null) return;
    shiftRef.current = e.shiftKey;
    pressRef.current = { kind: 'handle', handle, startScreen: { x: e.clientX, y: e.clientY } };
    capturePointer(e);
  };

  /**
   * Capture the pointer on the pressed element itself so that click/dblclick
   * keep firing on it (they synthesize at the common ancestor of the down and
   * up targets). Drag safety comes from `user-select: none` on the board —
   * without it, a drag crossing note text starts a native text selection and
   * the browser cancels the pointer stream mid-gesture.
   */
  const capturePointer = (e: PointerEvent) => {
    try {
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture unsupported — window listeners still receive the events */
    }
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      shiftRef.current = e.shiftKey;
      const press = pressRef.current;
      if (press) {
        const dist = Math.hypot(e.clientX - press.startScreen.x, e.clientY - press.startScreen.y);
        if (dist >= DRAG_THRESHOLD_PX) {
          startGesture(press, e);
          pressRef.current = null;
        }
      }
      const g = gestureRef.current;
      if (g) {
        lastScreenRef.current = { x: e.clientX, y: e.clientY };
        if (rafRef.current === 0) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const s = lastScreenRef.current;
            const gg = gestureRef.current;
            if (s && gg) applyGesture(gg, s);
          });
        }
      }
    };

    const finish = (applyFinal: boolean) => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const g = gestureRef.current;
      if (g) {
        if (applyFinal && lastScreenRef.current) applyGesture(g, lastScreenRef.current);
        optsRef.current.onGestureEnd?.();
        gestureRef.current = null;
      }
      pressRef.current = null;
      lastScreenRef.current = null;
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onObjectPointerDown, onHandlePointerDown };
}
