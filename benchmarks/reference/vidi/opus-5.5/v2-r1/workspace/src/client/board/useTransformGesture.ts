// Generic select / move / resize gesture for every object type (story 7).
//
// Idle → Pressed (pointerdown on an object or a handle) → Moving / Resizing once the pointer has
// moved DRAG_THRESHOLD_PX → Idle on pointerup or pointercancel. Every frame writes absolute rects
// computed from the rects captured when the gesture started, so concurrent remote changes to the
// same objects converge to the last writer instead of drifting.
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  type ObjectSnapshot,
  bringObjectsToFront,
  hasObject,
  moveObjects,
  objectBounds,
  resizeObjects,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  type Handle,
  type Point,
  type Rect,
  clampScale,
  handleScale,
  scaleFromHandle,
  scaleWithin,
  unionRects,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

const PRIMARY_BUTTON = 0;

type PointerLike = Pick<
  ReactPointerEvent<Element> | PointerEvent,
  'button' | 'pointerId' | 'clientX' | 'clientY' | 'shiftKey' | 'currentTarget' | 'stopPropagation'
>;

export interface TransformGestureOptions {
  doc: Y.Doc;
  /** The current camera, or a function returning it (read when a gesture starts). */
  camera: Camera | (() => Camera);
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Called once when a move or resize actually starts (story 8 undo boundaries). */
  onGestureStart?(): void;
  /** Called once when that gesture ends (pointerup or pointercancel). */
  onGestureEnd?(): void;
}

export type GestureKind = 'move' | 'resize';

interface Session {
  kind: GestureKind;
  pointerId: number;
  start: Point;
  zoom: number;
  ids: string[];
  /** Runs on release without a drag (e.g. Shift-click removing an already selected object). */
  onClick: (() => void) | null;
  /** False when the board is locked: selection only, no gesture. */
  canTransform: boolean;
  active: boolean;
  startRects: Map<string, Rect>;
  // Resize only.
  handle?: Handle;
  box?: Rect;
  /** Resizable ids and their type's minimum size. */
  resizable?: Map<string, number>;
  aspectLocked?: boolean;
  pending: { dx: number; dy: number; shift: boolean } | null;
  frame: number | null;
  target: Element | null;
  detach: () => void;
}

function cameraOf(camera: Camera | (() => Camera)): Camera {
  return typeof camera === 'function' ? camera() : camera;
}

export function useTransformGesture(opts: TransformGestureOptions): {
  onObjectPointerDown(e: PointerLike, id: string): void;
  onHandlePointerDown(e: PointerLike, handle: Handle): void;
  /** The gesture in progress (after the drag threshold), if any. */
  gesture: GestureKind | null;
} {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sessionRef = useRef<Session | null>(null);
  const [gesture, setGesture] = useState<GestureKind | null>(null);

  const finish = useCallback((s: Session) => {
    if (sessionRef.current !== s) return;
    if (s.frame !== null) cancelAnimationFrame(s.frame);
    s.frame = null;
    s.detach();
    sessionRef.current = null;
    if (s.active) {
      setGesture(null);
      optsRef.current.onGestureEnd?.();
    }
  }, []);

  const apply = useCallback(
    (s: Session) => {
      const p = s.pending;
      s.pending = null;
      if (!p || !s.active) return;
      const { doc, canEdit } = optsRef.current;
      // The board was locked mid-gesture: stop without changing anything further.
      if (!canEdit) {
        finish(s);
        return;
      }
      const present = s.ids.filter((id) => hasObject(doc, id));
      // Everything being moved was deleted meanwhile: the gesture ends silently.
      if (present.length === 0) {
        finish(s);
        return;
      }
      const dx = p.dx / s.zoom;
      const dy = p.dy / s.zoom;
      if (s.kind === 'move') {
        const positions = new Map<string, Point>();
        for (const id of present) {
          const r = s.startRects.get(id)!;
          positions.set(id, { x: r.x + dx, y: r.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }
      const box = s.box!;
      const aspect = s.aspectLocked! || p.shift;
      const limited = present.filter((id) => s.resizable!.has(id));
      const wanted = handleScale(box, s.handle!, { x: dx, y: dy }, aspect);
      const scale = clampScale(
        wanted,
        limited.map((id) => s.startRects.get(id)!),
        limited.map((id) => s.resizable!.get(id)!),
        MAX_OBJECT_SIZE_WORLD,
        aspect,
      );
      const to = scaleFromHandle(box, s.handle!, scale);
      const rects = new Map<string, Rect>();
      const positions = new Map<string, Point>();
      for (const id of present) {
        const r = scaleWithin(s.startRects.get(id)!, box, to);
        if (s.resizable!.has(id)) rects.set(id, r);
        else positions.set(id, { x: r.x, y: r.y });
      }
      resizeObjects(doc, rects);
      if (positions.size > 0) moveObjects(doc, positions);
    },
    [finish],
  );

  const activate = useCallback((s: Session): boolean => {
    const { doc, onGestureStart } = optsRef.current;
    const ids = s.ids.filter((id) => hasObject(doc, id) && s.startRects.has(id));
    if (ids.length === 0) return false;
    s.ids = ids;
    s.active = true;
    onGestureStart?.();
    if (s.kind === 'move') bringObjectsToFront(doc, ids);
    setGesture(s.kind);
    return true;
  }, []);

  const begin = useCallback(
    (e: PointerLike, init: Omit<Session, 'pointerId' | 'start' | 'zoom' | 'active' | 'pending' | 'frame' | 'target' | 'detach'>) => {
      const prev = sessionRef.current;
      if (prev) finish(prev);
      const target = e.currentTarget instanceof Element ? e.currentTarget : null;
      const s: Session = {
        ...init,
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        zoom: cameraOf(optsRef.current.camera).zoom,
        active: false,
        pending: null,
        frame: null,
        target,
        detach: () => {},
      };
      try {
        target?.setPointerCapture?.(e.pointerId);
      } catch {
        // Pointer already released; pointerup ends the gesture as usual.
      }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId || sessionRef.current !== s) return;
        const dx = ev.clientX - s.start.x;
        const dy = ev.clientY - s.start.y;
        if (!s.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          if (!s.canTransform || !optsRef.current.canEdit) return;
          if (!activate(s)) {
            finish(s);
            return;
          }
        }
        s.pending = { dx, dy, shift: ev.shiftKey };
        if (s.frame === null) {
          s.frame = requestAnimationFrame(() => {
            s.frame = null;
            apply(s);
          });
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId || sessionRef.current !== s) return;
        if (s.active) {
          if (s.frame !== null) cancelAnimationFrame(s.frame);
          s.frame = null;
          apply(s);
        } else {
          s.onClick?.();
        }
        finish(s);
      };
      // Interrupted: keep the last applied state; a move not yet drawn is dropped.
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== s.pointerId || sessionRef.current !== s) return;
        s.pending = null;
        finish(s);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      target?.addEventListener('lostpointercapture', onCancel as EventListener);
      s.detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        target?.removeEventListener('lostpointercapture', onCancel as EventListener);
      };
      sessionRef.current = s;
    },
    [activate, apply, finish],
  );

  const startRectsOf = (ids: readonly string[]) => {
    const byId = new Map(optsRef.current.snapshot.map((o) => [o.id, o]));
    const rects = new Map<string, Rect>();
    for (const id of ids) {
      const obj = byId.get(id);
      if (obj) rects.set(id, objectBounds(obj));
    }
    return rects;
  };

  const onObjectPointerDown = useCallback(
    (e: PointerLike, id: string) => {
      // Never let a press on an object reach the board (no pan, no deselect, no marquee).
      e.stopPropagation();
      if (e.button !== PRIMARY_BUTTON) return;
      const { selection, canEdit } = optsRef.current;
      if (selection.editingId === id) return;
      const current = selection.ids;
      const wasSelected = current.has(id);
      let ids: string[];
      let onClick: (() => void) | null = null;
      if (e.shiftKey) {
        if (wasSelected) {
          // Removed on release, so that Shift-dragging a selected object still moves the group.
          ids = [...current];
          onClick = () => optsRef.current.selection.toggle(id);
        } else {
          selection.toggle(id);
          ids = [...current, id];
        }
      } else if (wasSelected) {
        ids = [...current];
        // A click (no drag) on one member of a group selects just that member.
        if (current.size > 1 || selection.editingId !== null) {
          onClick = () => optsRef.current.selection.click(id);
        }
      } else {
        selection.click(id);
        ids = [id];
      }
      begin(e, { kind: 'move', ids, onClick, canTransform: canEdit, startRects: startRectsOf(ids) });
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: PointerLike, handle: Handle) => {
      e.stopPropagation();
      if (e.button !== PRIMARY_BUTTON) return;
      const { selection, snapshot, canEdit } = optsRef.current;
      if (!canEdit) return;
      const objects = snapshot.filter((o) => selection.ids.has(o.id));
      const resizable = new Map<string, number>();
      let aspectLocked = false;
      for (const o of objects) {
        const spec = getObjectType(o.type);
        if (!spec?.resizable) continue;
        resizable.set(o.id, spec.minSize);
        aspectLocked ||= spec.aspectLocked;
      }
      if (resizable.size === 0) return;
      const ids = objects.map((o) => o.id);
      const startRects = startRectsOf(ids);
      const box = unionRects([...startRects.values()]);
      if (!box) return;
      begin(e, {
        kind: 'resize',
        ids,
        onClick: null,
        canTransform: true,
        startRects,
        handle,
        box,
        resizable,
        aspectLocked,
      });
    },
    [begin],
  );

  useEffect(
    () => () => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.frame !== null) cancelAnimationFrame(s.frame);
      s.detach();
      sessionRef.current = null;
    },
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, gesture };
}
