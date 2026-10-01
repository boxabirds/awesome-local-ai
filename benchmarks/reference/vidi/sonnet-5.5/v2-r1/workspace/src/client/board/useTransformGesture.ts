import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { bringObjectsToFront, moveObjects, objectBounds, resizeObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { clampScale, resizeRect, scaleFromHandle, scaleWithin, unionRects } from '../../shared/geometry';
import type { Handle, Point, Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { applyTextResize } from '../objects/textResize';
import { getDefaultMeasurer } from '../objects/textLayout';
import type { Selection } from './useSelection';

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  kind: 'move' | 'resize';
  /** Objects the gesture acts on (for a press on an unselected object this is already the new selection). */
  ids: string[];
  /** Object under a move press; null for handles. */
  id: string | null;
  handle: Handle | null;
  shift: boolean;
  wasSelected: boolean;
  started: boolean;
  starts: Map<string, Rect>;
  box: Rect | null;
  minSizes: number[];
  aspectLocked: boolean;
  /** Resized objects whose height follows their content (text); they only take a width from the gesture. */
  autoHeightIds: Set<string>;
  lastEvent: { dx: number; dy: number; shift: boolean } | null;
}

export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): {
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
} {
  const live = useRef(opts);
  live.current = opts;
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const apply = useCallback(() => {
    frame.current = null;
    const p = press.current;
    if (!p || !p.started || !p.lastEvent) return;
    const { doc, camera } = live.current;
    const dx = p.lastEvent.dx / camera.zoom;
    const dy = p.lastEvent.dy / camera.zoom;
    if (p.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, r] of p.starts) positions.set(id, { x: r.x + dx, y: r.y + dy });
      moveObjects(doc, positions);
      return;
    }
    if (!p.box || !p.handle) return;
    const raw = resizeRect(p.box, p.handle, { x: dx, y: dy }, p.aspectLocked || p.lastEvent.shift);
    const want = { x: raw.width / p.box.width, y: raw.height / p.box.height };
    const clampRects = [...p.starts].map(([id, r]) => (p.autoHeightIds.has(id) ? { ...r, height: 0 } : r));
    const scale = clampScale(want, clampRects, p.minSizes, MAX_OBJECT_SIZE_WORLD);
    const target = scale.x === want.x && scale.y === want.y ? raw : scaleFromHandle(p.box, p.handle, scale);
    const rects = new Map<string, Rect>();
    const textRects = new Map<string, Rect>();
    for (const [id, r] of p.starts) (p.autoHeightIds.has(id) ? textRects : rects).set(id, scaleWithin(r, p.box, target));
    resizeObjects(doc, rects);
    applyTextResize(doc, textRects, rects.size === 0, getDefaultMeasurer());
  }, []);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  const finish = useCallback(
    (e: PointerEvent | null, cancelled: boolean) => {
      const p = press.current;
      if (!p) return;
      press.current = null;
      detach.current?.();
      detach.current = null;
      cancelFrame();
      const { selection } = live.current;
      if (p.started) {
        press.current = p;
        if (!cancelled) apply();
        press.current = null;
        live.current.onGestureEnd?.();
      } else if (!cancelled && p.kind === 'move' && p.id !== null && e) {
        // A click: shift toggles, a plain click on an already selected object narrows to it.
        if (p.shift) selection.toggle(p.id);
        else if (p.wasSelected) selection.click(p.id);
      }
    },
    [apply],
  );

  const begin = useCallback(
    (e: ReactPointerEvent, init: Omit<Press, 'pointerId' | 'startX' | 'startY' | 'started' | 'starts' | 'lastEvent' | 'shift'>) => {
      if (e.button !== 0 || press.current) return;
      press.current = {
        ...init,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        shift: e.shiftKey,
        started: false,
        starts: new Map(),
        lastEvent: null,
      };
      const onMove = (ev: PointerEvent) => {
        const p = press.current;
        if (!p || ev.pointerId !== p.pointerId) return;
        const dx = ev.clientX - p.startX;
        const dy = ev.clientY - p.startY;
        if (!p.started) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          if (!startGesture(p)) return;
        }
        p.lastEvent = { dx, dy, shift: ev.shiftKey };
        if (frame.current === null) frame.current = requestAnimationFrame(apply);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === press.current?.pointerId) finish(ev, false);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId === press.current?.pointerId) finish(ev, true);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      detach.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
    },
    [apply, finish],
  );

  /** Crosses the drag threshold: records start rects and raises the selection. False when the gesture is refused. */
  function startGesture(p: Press): boolean {
    const { doc, snapshot, canEdit, selection } = live.current;
    if (!canEdit) return false;
    const byId = new Map(snapshot.map((o) => [o.id, o]));
    const objects = p.ids.map((id) => byId.get(id)).filter((o): o is ObjectSnapshot => o !== undefined);
    if (objects.length === 0) return false;
    if (p.kind === 'resize') {
      const specs = objects.map((o) => getObjectType(o.type));
      if (!specs.some((s) => s?.resizable)) return false;
      p.minSizes = specs.map((s) => s?.minSize ?? 0);
      p.aspectLocked = specs.some((s) => s?.aspectLocked);
      p.autoHeightIds = new Set(objects.filter((o) => o.type === 'text').map((o) => o.id));
    }
    for (const o of objects) p.starts.set(o.id, objectBounds(o));
    p.box = unionRects([...p.starts.values()]);
    if (!p.box) return false;
    p.started = true;
    if (p.kind === 'move' && p.id !== null && !p.wasSelected) {
      if (p.shift) selection.toggle(p.id);
      else selection.click(p.id);
    }
    live.current.onGestureStart?.();
    if (p.kind === 'move') bringObjectsToFront(doc, [...p.starts.keys()]);
    return true;
  }

  useEffect(
    () => () => {
      cancelFrame();
      detach.current?.();
      if (press.current?.started) live.current.onGestureEnd?.();
      press.current = null;
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent, id: string) => {
      const { selection } = live.current;
      if (e.button !== 0 || press.current) return;
      let wasSelected = selection.ids.has(id);
      // Dragging a selected object moves the whole selection; an unselected one moves alone (or joins on Shift).
      const ids = wasSelected ? [...selection.ids] : e.shiftKey ? [...selection.ids, id] : [id];
      if (!wasSelected && !e.shiftKey) {
        selection.click(id);
        wasSelected = true;
      }
      begin(e, { kind: 'move', ids, id, handle: null, wasSelected, box: null, minSizes: [], aspectLocked: false, autoHeightIds: new Set() });
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: Handle) => {
      e.stopPropagation();
      begin(e, {
        kind: 'resize',
        ids: [...live.current.selection.ids],
        id: null,
        handle,
        wasSelected: true,
        box: null,
        minSizes: [],
        aspectLocked: false,
        autoHeightIds: new Set(),
      });
    },
    [begin],
  );

  return { onObjectPointerDown, onHandlePointerDown };
}
