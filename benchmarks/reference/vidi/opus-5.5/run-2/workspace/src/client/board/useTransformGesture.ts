/**
 * Generic move and resize of the selection (anchor: sel.transform). Every object type
 * delegates its pointerdown here; the selection overlay delegates its handles.
 *
 * Idle → Pressed (pointerdown) → Idle (released within DRAG_THRESHOLD_PX: a click) or
 * Moving / Resizing (moved at least DRAG_THRESHOLD_PX) → Idle (pointerup, pointercancel or
 * lost capture). Start rects are captured at the threshold crossing and each animation
 * frame writes absolute rects (start + delta, or the scaled rect), so concurrent writers
 * converge to the last one on every screen. Objects deleted mid-gesture are skipped by the
 * model. `onGestureStart` / `onGestureEnd` fire exactly once per gesture (story 8 uses them
 * as undo boundaries).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import {
  bringObjectsToFront,
  LOCAL_ORIGIN,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { applyScale, clampScale, resizeScale, scaleWithin, unionRects, type Handle, type Point, type Rect } from '../../shared/geometry';
import { getObjectType, moveSnapshots, type ObjectTypeSpec, type ResizeMode } from '../objects/registry';
import type { SelectionApi } from './useSelection';

const PRIMARY_BUTTON = 0;

/** The parts of a (React or native) pointer event the gesture needs. */
export interface PointerDownLike {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  currentTarget: EventTarget | null;
  stopPropagation(): void;
  preventDefault(): void;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface GestureState {
  kind: 'idle' | 'moving' | 'resizing';
  /** Objects being moved or resized. */
  ids: ReadonlySet<string>;
}

export interface TransformGestureApi {
  onObjectPointerDown(e: PointerDownLike, id: string): void;
  onHandlePointerDown(e: PointerDownLike, handle: Handle): void;
  gesture: GestureState;
}

interface Press {
  kind: 'move' | 'resize';
  pointerId: number;
  start: Point;
  zoom: number;
  ids: string[];
  /** Move only: the pressed object, whether it was selected, whether Shift was held. */
  id: string | null;
  wasSelected: boolean;
  shift: boolean;
  handle: Handle | null;
  active: boolean;
  starts: Map<string, Rect>;
  /** Each object's snapshot when the gesture started (story 10 arrows move from it). */
  startObjs: Map<string, ObjectSnapshot>;
  startBox: Rect | null;
  pending: { dx: number; dy: number; shift: boolean } | null;
  frame: number | null;
  detach(): void;
}

const IDLE: GestureState = { kind: 'idle', ids: new Set() };

function specOf(snapshot: readonly ObjectSnapshot[], id: string): ObjectTypeSpec | undefined {
  const obj = snapshot.find((o) => o.id === id);
  return obj === undefined ? undefined : getObjectType(obj.type);
}

/** True when at least one of the ids belongs to a resizable type (handles are shown). */
export function canResize(snapshot: readonly ObjectSnapshot[], ids: Iterable<string>): boolean {
  for (const id of ids) if (specOf(snapshot, id)?.resizable === true) return true;
  return false;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureApi {
  const latest = useRef(opts);
  latest.current = opts;
  const press = useRef<Press | null>(null);
  const [gesture, setGesture] = useState<GestureState>(IDLE);

  /** Writes the latest pending pointer position (absolute from the gesture start). */
  const flush = useCallback((p: Press) => {
    p.frame = null;
    const next = p.pending;
    p.pending = null;
    if (next === null) return;
    const { doc, snapshot } = latest.current;
    const d = { x: next.dx / p.zoom, y: next.dy / p.zoom };
    if (p.kind === 'move') {
      moveSnapshots(doc, [...p.startObjs.values()], d);
      return;
    }
    const box = p.startBox;
    if (box === null || p.handle === null) return;
    const ids = [...p.starts.keys()];
    const specs = ids.map((id) => specOf(snapshot, id));
    const byId = new Map(snapshot.map((o) => [o.id, o]));
    const mode: ResizeMode = specs.every((s) => s?.handles === 'horizontal') ? 'horizontal' : 'group';
    const locked = next.shift || specs.some((s) => s?.aspectLocked === true);
    const resizableRects: Rect[] = [];
    const minSizes: number[] = [];
    [...p.starts.values()].forEach((r, i) => {
      const spec = specs[i];
      const obj = byId.get(ids[i]!);
      if (spec?.resizable !== true || obj === undefined) return;
      // Axes an object does not scale on (e.g. text height) never limit the group.
      const axes = spec.scalesWith?.(obj, mode) ?? { x: true, y: true };
      resizableRects.push({ ...r, width: axes.x ? r.width : 0, height: axes.y ? r.height : 0 });
      minSizes.push(spec.minSize);
    });
    const scale = clampScale(resizeScale(box, p.handle, d, locked), resizableRects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = applyScale(box, p.handle, scale);
    const rects = new Map<string, Rect>();
    const custom: (() => void)[] = [];
    [...p.starts.entries()].forEach(([id, r], i) => {
      const scaled = scaleWithin(r, box, to);
      const spec = specs[i];
      const obj = byId.get(id);
      const start = p.startObjs.get(id);
      if (spec?.applyResize !== undefined && obj !== undefined && start !== undefined) {
        const apply = spec.applyResize;
        custom.push(() => apply(doc, obj, scaled, r, mode, start));
        return;
      }
      // Objects that cannot be resized keep their size and follow the layout.
      rects.set(id, spec?.resizable === true ? scaled : { ...r, x: scaled.x, y: scaled.y });
    });
    // One update per frame, whatever each type writes.
    doc.transact(() => {
      resizeObjects(doc, rects);
      custom.forEach((fn) => fn());
    }, LOCAL_ORIGIN);
  }, []);

  const finish = useCallback((p: Press, keepPending: boolean) => {
    if (p.frame !== null) cancelAnimationFrame(p.frame);
    p.frame = null;
    if (keepPending) flush(p);
    p.detach();
    if (press.current === p) press.current = null;
    if (p.active) {
      setGesture(IDLE);
      latest.current.onGestureEnd?.();
    }
  }, [flush]);

  const begin = useCallback(
    (p: Press) => {
      const { snapshot, doc, selection } = latest.current;
      const byId = new Map(snapshot.map((o) => [o.id, o]));
      for (const id of p.ids) {
        const obj = byId.get(id);
        if (obj === undefined) continue;
        p.starts.set(id, objectBounds(obj));
        p.startObjs.set(id, obj);
      }
      if (p.starts.size === 0) return false;
      p.startBox = unionRects([...p.starts.values()]);
      p.active = true;
      if (p.kind === 'move' && p.id !== null && p.shift && !p.wasSelected) selection.setMany([p.id], true);
      latest.current.onGestureStart?.();
      setGesture({ kind: p.kind === 'move' ? 'moving' : 'resizing', ids: new Set(p.starts.keys()) });
      if (p.kind === 'move') bringObjectsToFront(doc, [...p.starts.keys()]);
      return true;
    },
    [],
  );

  const startPress = useCallback(
    (e: PointerDownLike, init: Pick<Press, 'kind' | 'ids' | 'id' | 'wasSelected' | 'shift' | 'handle'>) => {
      if (press.current !== null) finish(press.current, false);
      const target = e.currentTarget instanceof Element ? e.currentTarget : null;
      (target as (Element & { setPointerCapture?(id: number): void }) | null)?.setPointerCapture?.(e.pointerId);
      const p: Press = {
        ...init,
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        zoom: latest.current.camera.zoom,
        active: false,
        starts: new Map(),
        startObjs: new Map(),
        startBox: null,
        pending: null,
        frame: null,
        detach: () => undefined,
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== p.pointerId) return;
        const dx = ev.clientX - p.start.x;
        const dy = ev.clientY - p.start.y;
        if (!p.active) {
          if (!latest.current.canEdit || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          if (!begin(p)) {
            finish(p, false);
            return;
          }
        }
        p.pending = { dx, dy, shift: ev.shiftKey };
        if (p.frame === null) p.frame = requestAnimationFrame(() => flush(p));
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== p.pointerId) return;
        if (!p.active && p.kind === 'move' && p.id !== null) {
          // A click: Shift toggles, a plain click selects only this object.
          const { selection } = latest.current;
          if (p.shift) selection.toggle(p.id);
          else selection.click(p.id);
        }
        finish(p, true); // the release point is where the selection ends up
      };
      /** Interrupted: the last applied state is kept. */
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== p.pointerId) return;
        finish(p, false);
      };
      // Window capture listeners: they see the captured pointer even if the pressed
      // element is removed mid-gesture (object deleted by someone else).
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('lostpointercapture', onCancel, true);
      p.detach = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('lostpointercapture', onCancel, true);
      };
      press.current = p;
    },
    [begin, finish, flush],
  );

  const onObjectPointerDown = useCallback(
    (e: PointerDownLike, id: string) => {
      // The board must never pan (or clear the selection) because of a press on an object.
      e.stopPropagation();
      if (e.button !== PRIMARY_BUTTON) return;
      const { selection } = latest.current;
      const wasSelected = selection.ids.has(id);
      const shift = e.shiftKey;
      // Dragging an unselected object selects just it (sel.drag_unselected).
      if (!wasSelected && !shift) selection.click(id);
      const ids = wasSelected ? [...selection.ids] : shift ? [...selection.ids, id] : [id];
      startPress(e, { kind: 'move', ids, id, wasSelected, shift, handle: null });
    },
    [startPress],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerDownLike, handle: Handle) => {
      e.stopPropagation();
      e.preventDefault();
      const { selection, snapshot, canEdit } = latest.current;
      if (e.button !== PRIMARY_BUTTON || !canEdit || !canResize(snapshot, selection.ids)) return;
      startPress(e, { kind: 'resize', ids: [...selection.ids], id: null, wasSelected: true, shift: e.shiftKey, handle });
    },
    [startPress],
  );

  // Unmounting ends any gesture.
  useEffect(
    () => () => {
      if (press.current !== null) finish(press.current, false);
    },
    [finish],
  );

  return { onObjectPointerDown, onHandlePointerDown, gesture };
}
