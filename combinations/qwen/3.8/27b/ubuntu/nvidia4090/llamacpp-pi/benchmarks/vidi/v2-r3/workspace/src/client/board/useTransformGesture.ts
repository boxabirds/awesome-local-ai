import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
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
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { setTextWidthFixed } from '../../shared/objects/text';
import { createCanvasMeasurer, type Measurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import type { SelectionApi } from './useSelection';

type MoveGesture = {
  kind: 'move';
  pointerId: number;
  captureEl: Element | null;
  startScreen: Point;
  ids: string[];
  active: boolean;
  startRects: Map<string, Rect> | null;
};
type ResizeGesture = {
  kind: 'resize';
  pointerId: number;
  captureEl: Element | null;
  startScreen: Point;
  handle: Handle;
  box: Rect;
  ids: string[];
  startRects: Map<string, Rect>;
  minSizes: number[];
  anyAspect: boolean;
  /**
   * Story 9: set when the selection is a single text object and the handle is
   * e/w — the drag changes only the width (fixed mode) and re-measures the
   * height from the content, instead of scaling the box.
   */
  textWidthId: string | null;
  active: boolean;
};
type Gesture = MoveGesture | ResizeGesture;

/**
 * Story 7 (sel.transform): the generic transform gesture. Dragging an object
 * moves the whole selection (an unselected object is selected first); dragging
 * a bounding-box handle resizes the selection, keeping aspect for aspect-locked
 * types and clamping every object to its min size and the global max size.
 *
 * Writes are absolute positions/rects (one Yjs transaction per event) so
 * concurrent edits by others converge. `canEdit === false` → gestures ignored
 * (selection still works). pointercancel keeps the last applied state.
 */
export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): {
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
} {
  const { doc, selection, canEdit } = opts;
  const gestureRef = useRef<Gesture | null>(null);
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const startRef = useRef(opts.onGestureStart);
  startRef.current = opts.onGestureStart;
  const endRef = useRef(opts.onGestureEnd);
  endRef.current = opts.onGestureEnd;
  const measurerRef = useRef<Measurer | null>(null);
  if (measurerRef.current === null) measurerRef.current = createCanvasMeasurer();

  const onObjectPointerDown = (e: React.PointerEvent, id: string): void => {
    // Shift-click toggles membership in the selection and never moves.
    if (e.shiftKey) {
      selectionRef.current.toggle(id);
      return;
    }
    const ids = selectionRef.current.ids;
    const wasSelected = ids.has(id);
    const newIds = wasSelected ? [...ids] : [id];
    if (!wasSelected) selectionRef.current.click(id);
    if (!canEditRef.current) return; // select, but do not move
    const el = e.currentTarget as Element | null;
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    gestureRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      captureEl: el,
      startScreen: { x: e.clientX, y: e.clientY },
      ids: newIds,
      active: false,
      startRects: null,
    };
  };

  const onHandlePointerDown = (e: React.PointerEvent, handle: Handle): void => {
    if (!canEditRef.current) return;
    const snap = snapshotRef.current;
    const ids = selectionRef.current.ids;
    const selObjs = snap.filter((o) => ids.has(o.id));
    if (selObjs.length === 0) return;
    const resizable = selObjs.some((o) => getObjectType(o.type)?.resizable);
    if (!resizable) return;
    const box = unionRects(selObjs.map(objectBounds));
    if (!box) return;
    const el = e.currentTarget as Element | null;
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    const gid = selObjs.map((o) => o.id);
    const startRects = new Map<string, Rect>();
    const minSizes: number[] = [];
    let anyAspect = false;
    for (const o of selObjs) {
      startRects.set(o.id, objectBounds(o));
      const spec = getObjectType(o.type);
      minSizes.push(spec?.minSize ?? 0);
      if (spec?.aspectLocked) anyAspect = true;
    }
    // Story 9: a single text object dragged by e/w resizes its width (fixed
    // mode) and re-measures its height; the generic box scaling is bypassed.
    const singleText =
      selObjs.length === 1 &&
      selObjs[0].type === 'text' &&
      (handle === 'e' || handle === 'w');
    gestureRef.current = {
      kind: 'resize',
      pointerId: e.pointerId,
      captureEl: el,
      startScreen: { x: e.clientX, y: e.clientY },
      handle,
      box,
      ids: gid,
      startRects,
      minSizes,
      anyAspect,
      textWidthId: singleText ? gid[0] : null,
      active: false,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startScreen.x;
      const dy = e.clientY - g.startScreen.y;
      if (!g.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        g.active = true;
        startRef.current?.();
        if (g.kind === 'move') {
          const snap = snapshotRef.current;
          const rects = new Map<string, Rect>();
          for (const id of g.ids) {
            const o = snap.find((s) => s.id === id);
            if (o) rects.set(id, objectBounds(o));
          }
          g.startRects = rects;
          bringObjectsToFront(doc, g.ids);
        }
      }
      const zoom = cameraRef.current.zoom;
      if (g.kind === 'move') {
        applyMove(g, dx / zoom, dy / zoom);
      } else {
        applyResize(g, dx / zoom, dy / zoom, e.shiftKey);
      }
    };

    const finish = (e: PointerEvent, _up: boolean) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      gestureRef.current = null;
      try {
        g.captureEl?.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture may already be released
      }
      if (g.active) endRef.current?.();
    };

    const onUp = (e: PointerEvent) => finish(e, true);
    const onCancel = (e: PointerEvent) => finish(e, false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const applyMove = (g: MoveGesture, worldDx: number, worldDy: number): void => {
    const rects = g.startRects;
    if (!rects) return;
    const positions = new Map<string, Point>();
    for (const id of g.ids) {
      const sr = rects.get(id);
      if (!sr) continue; // pruned mid-gesture: skip
      positions.set(id, { x: sr.x + worldDx, y: sr.y + worldDy });
    }
    moveObjects(doc, positions);
  };

  const applyResize = (g: ResizeGesture, worldDx: number, worldDy: number, shift: boolean): void => {
    // Story 9 (text.object): single text + side handle → width-only resize.
    if (g.textWidthId !== null) {
      const id = g.textWidthId;
      const sr = g.startRects.get(id);
      if (!sr) return; // pruned mid-gesture: skip
      const rawWidth = g.handle === 'e' ? sr.width + worldDx : sr.width - worldDx;
      const width = Math.min(Math.max(rawWidth, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
      if (g.handle === 'w') {
        const x = sr.x + sr.width - width; // right edge anchored
        if (Math.abs(x - sr.x) > 1e-9) {
          moveObjects(doc, new Map([[id, { x, y: sr.y }]]));
        }
      }
      setTextWidthFixed(doc, id, width);
      // Re-measure the wrapped height at the new fixed width (same capture
      // window → the whole drag is one undo step).
      remeasureTextBox(doc, id, measurerRef.current!);
      return;
    }
    const aspectLocked = g.anyAspect || shift;
    const proposed = resizeRect(g.box, g.handle, { x: worldDx, y: worldDy }, aspectLocked);
    const scale = {
      x: g.box.width > 0 ? proposed.width / g.box.width : 1,
      y: g.box.height > 0 ? proposed.height / g.box.height : 1,
    };
    const startRects = g.ids.map((id) => g.startRects.get(id)).filter((r): r is Rect => r !== undefined);
    const clamped = clampScale(scale, startRects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
    const w = g.box.width * clamped.x;
    const h = g.box.height * clamped.y;
    const x = g.handle.includes('w') ? g.box.x + g.box.width - w : g.box.x;
    const y = g.handle.includes('n') ? g.box.y + g.box.height - h : g.box.y;
    const to: Rect = { x, y, width: w, height: h };
    const rects = new Map<string, Rect>();
    for (const id of g.ids) {
      const sr = g.startRects.get(id);
      if (!sr) continue; // pruned mid-gesture: skip
      rects.set(id, scaleWithin(sr, g.box, to));
    }
    resizeObjects(doc, rects);
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
