import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { bringObjectsToFront, moveObjects, objectBounds, resizeObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  anchorBox,
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * Generic transform gesture (story 7, sel.transform).
 *
 * Two gesture kinds, both driven by window-level pointer events (robust
 * against React reordering the notes by z mid-drag; no per-element capture
 * state to lose):
 *
 *  - object drag: a press on an object moves the whole selection once the
 *    pointer crosses DRAG_THRESHOLD_PX. Start rects are captured at the
 *    crossing and every rAF frame writes absolute `start + delta/zoom`
 *    positions (Key decision 1 — absolute writes converge to the last
 *    writer when a remote peer moves the same object concurrently).
 *  - handle resize: a press on a SelectionOverlay handle resizes the
 *    selection's bounding box: resizeRect (aspect-locked when any selected
 *    spec is aspectLocked or Shift is held) → clampScale against per-type
 *    minSize and MAX_OBJECT_SIZE_WORLD → scaleWithin per object →
 *    resizeObjects.
 *
 * Selection rules (view state, work on locked boards): a press released
 * under the threshold clicks (Shift toggles) the pressed object; dragging an
 * unselected object clicks it first, then moves it (sel.drag_unselected).
 * `canEdit === false` (load failed) refuses the gesture at the threshold
 * crossing — no writes ever happen. `onGestureStart` / `onGestureEnd` fire
 * exactly once per started gesture (story 8 undo boundaries); a cancelled
 * gesture keeps the last applied state.
 */
interface Gesture {
  kind: 'object' | 'handle';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  objectId: string | null;
  handle: Handle | null;
  started: boolean;
  /** Start rects of every live selected object (captured at threshold crossing). */
  startRects: Map<string, Rect> | null;
  /** Bounding box at gesture start (handle kind). */
  startBox: Rect | null;
  /** Shift state at the last pointer event (aspect lock + click vs toggle). */
  shift: boolean;
  /** Threshold crossing was refused (locked board): the press stays a click. */
  refused: boolean;
  /** Last pointer delta, screen px. */
  pending: { x: number; y: number } | null;
  rafId: number | null;
}

export interface TransformGesture {
  /** Called from an object's pointerdown (delegated from its component). */
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  /** Called from a SelectionOverlay handle's pointerdown. */
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): TransformGesture {
  const gestureRef = useRef<Gesture | null>(null);

  // Live refs so the window listeners (mounted once) always see fresh values.
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
  const startRef = useRef(opts.onGestureStart);
  startRef.current = opts.onGestureStart;
  const endRef = useRef(opts.onGestureEnd);
  endRef.current = opts.onGestureEnd;

  const snapshotById = (id: string): ObjectSnapshot | undefined => {
    for (const o of snapshotRef.current) if (o.id === id) return o;
    return undefined;
  };

  const setDraggingCursor = (on: boolean): void => {
    document.body.classList.toggle('vidi6-body-dragging', on);
  };

  const abortGesture = (): void => {
    const g = gestureRef.current;
    if (g === null) return;
    gestureRef.current = null;
    if (g.rafId !== null) cancelAnimationFrame(g.rafId);
    if (g.started) setDraggingCursor(false);
  };

  /**
   * Threshold crossing: commit the gesture. Returns false when refused.
   *
   * The moved ids are captured locally: for an object gesture on an
   * UNSELECTED object, sel.drag_unselected clicks it first (selection =
   * {id}), and the click's state update is not visible in the ref yet, so
   * the moved set must not be read from the (stale) selection.
   */
  const beginGesture = (g: Gesture): boolean => {
    if (!canEditRef.current) return false; // locked board: viewing only
    let ids: string[];
    if (g.kind === 'object' && g.objectId !== null && !selectionRef.current.ids.has(g.objectId)) {
      // Dragging an unselected object selects just it, then moves it.
      selectionRef.current.click(g.objectId);
      ids = [g.objectId];
    } else {
      ids = [...selectionRef.current.ids];
    }
    const rects = new Map<string, Rect>();
    for (const o of snapshotRef.current) {
      if (ids.includes(o.id)) rects.set(o.id, objectBounds(o));
    }
    if (rects.size === 0) return false;
    g.startRects = rects;
    g.startBox = unionRects([...rects.values()]);
    g.started = true;
    setDraggingCursor(true);
    startRef.current?.();
    if (g.kind === 'object') {
      // The grabbed selection renders above unselected objects (relative z kept).
      bringObjectsToFront(docRef.current, ids);
    }
    return true;
  };

  const applyMove = (g: Gesture): void => {
    const rects = g.startRects;
    const p = g.pending;
    if (rects === null || p === null) return;
    const zoom = cameraRef.current.zoom;
    const dx = p.x / zoom;
    const dy = p.y / zoom;
    const positions = new Map<string, Point>();
    rects.forEach((r, id) => positions.set(id, { x: r.x + dx, y: r.y + dy }));
    // moveObjects skips ids deleted remotely; 0 = the whole selection is gone.
    if (moveObjects(docRef.current, positions) === 0) abortGesture();
  };

  const applyResize = (g: Gesture): void => {
    const startRects = g.startRects;
    const box = g.startBox;
    const handle = g.handle;
    const p = g.pending;
    if (startRects === null || box === null || handle === null || p === null) return;
    // Objects pruned (deleted remotely) or deselected mid-gesture are skipped.
    const sel = selectionRef.current;
    const live = new Map<string, Rect>();
    startRects.forEach((r, id) => {
      if (sel.ids.has(id)) live.set(id, r);
    });
    if (live.size === 0) {
      abortGesture();
      return;
    }
    const zoom = cameraRef.current.zoom;
    const delta: Point = { x: p.x / zoom, y: p.y / zoom };
    // Aspect locked when Shift is held or any selected spec keeps proportions.
    let aspectLocked = g.shift;
    for (const id of live.keys()) {
      if (getObjectType(snapshotById(id)?.type ?? '')?.aspectLocked === true) {
        aspectLocked = true;
        break;
      }
    }
    const raw = resizeRect(box, handle, delta, aspectLocked);
    const scale: Point = {
      x: box.width > 0 ? raw.width / box.width : 1,
      y: box.height > 0 ? raw.height / box.height : 1,
    };
    // One uniform clamped scale: the first object to reach its min/max wins.
    const rectsArr: Rect[] = [];
    const minSizes: number[] = [];
    live.forEach((r, id) => {
      rectsArr.push(r);
      minSizes.push(getObjectType(snapshotById(id)?.type ?? '')?.minSize ?? 0);
    });
    const clamped = clampScale(scale, rectsArr, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to: Rect = anchorBox(box, handle, clamped);
    const out = new Map<string, Rect>();
    live.forEach((r, id) => out.set(id, scaleWithin(r, box, to)));
    // resizeObjects validates finiteness itself (0 = nothing written).
    if (resizeObjects(docRef.current, out) === 0) abortGesture();
  };

  const flush = (g: Gesture): void => {
    if (g.pending === null) return;
    if (g.kind === 'object') applyMove(g);
    else applyResize(g);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const g = gestureRef.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    g.shift = e.shiftKey;
    const dx = e.clientX - g.startClientX;
    const dy = e.clientY - g.startClientY;
    if (!g.started) {
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      if (g.refused) return; // locked board: the press stays a click
      if (!beginGesture(g)) {
        // Refused (locked board): the press degrades to a plain click on
        // release (select/toggle for viewing); no writes ever happen.
        g.refused = true;
        return;
      }
    }
    g.pending = { x: dx, y: dy };
    if (g.rafId === null) {
      g.rafId = requestAnimationFrame(() => {
        const cur = gestureRef.current;
        if (cur === null || cur.rafId === null) return;
        cur.rafId = null;
        flush(cur);
      });
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean): void => {
    const g = gestureRef.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    gestureRef.current = null;
    if (g.rafId !== null) cancelAnimationFrame(g.rafId);
    if (!g.started) {
      // A press without movement (or a refused one): select (Shift toggles).
      // Selection is view state, so it works on locked boards too.
      if (!cancelled && g.objectId !== null) {
        if (g.shift || e.shiftKey) selectionRef.current.toggle(g.objectId);
        else selectionRef.current.click(g.objectId);
      }
      return;
    }
    // Keep the last applied state: flush one final absolute write.
    flush(g);
    setDraggingCursor(false);
    endRef.current?.();
  };

  useEffect(() => {
    const onUp = (e: PointerEvent): void => finish(e, false);
    const onCancel = (e: PointerEvent): void => finish(e, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onObjectPointerDown = (e: PointerEvent, id: string): void => {
    if (e.button !== 0 || gestureRef.current !== null) return;
    gestureRef.current = {
      kind: 'object',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      objectId: id,
      handle: null,
      started: false,
      startRects: null,
      startBox: null,
      shift: e.shiftKey,
      refused: false,
      pending: null,
      rafId: null,
    };
  };

  const onHandlePointerDown = (e: PointerEvent, handle: Handle): void => {
    if (e.button !== 0 || gestureRef.current !== null) return;
    if (!canEditRef.current) return; // locked board: no resize
    const sel = selectionRef.current;
    if (sel.ids.size === 0) return;
    // Handles are only rendered when a selected type is resizable, but a
    // remote change could have removed it between render and press.
    let resizable = false;
    for (const o of snapshotRef.current) {
      if (sel.ids.has(o.id) && getObjectType(o.type)?.resizable === true) {
        resizable = true;
        break;
      }
    }
    if (!resizable) return;
    gestureRef.current = {
      kind: 'handle',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      objectId: null,
      handle,
      started: false,
      startRects: null,
      startBox: null,
      shift: e.shiftKey,
      refused: false,
      pending: null,
      rafId: null,
    };
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
