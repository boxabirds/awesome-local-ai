import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  type ObjectSnapshot,
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  objectsSnapshot,
  resizeObjects,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  type Handle,
  type Point,
  type Rect,
  clampScale,
  resizeRect,
  scaleFromHandle,
  scaleWithin,
  unionRects,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

const PRIMARY_BUTTON = 0;

type AnyPointerEvent = PointerEvent | ReactPointerEvent<Element>;

interface Press {
  pointerId: number;
  element: Element;
  start: Point;
  kind: 'move' | 'resize';
  handle: Handle | null;
  /** Object pressed (move only); a click without drag selects just it. */
  objectId: string | null;
  ids: string[];
  active: boolean;
  startRects: Map<string, Rect>;
  types: Map<string, string>;
  box: Rect | null;
  shift: boolean;
  /** Latest pointer position not yet written. */
  pending: Point | null;
  cleanup: () => void;
}

/**
 * The generic move/resize gesture for every object type (sel.transform).
 * Writes are absolute (start rect + delta), rAF-throttled, and refused while
 * `canEdit` is false. `onGestureStart/End` run exactly once per gesture.
 */
export function useTransformGesture(opts: {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}): {
  onObjectPointerDown(e: AnyPointerEvent, id: string): void;
  onHandlePointerDown(e: AnyPointerEvent, handle: Handle): void;
  /** The gesture currently changing the board, if any. */
  active: 'move' | 'resize' | null;
} {
  const latest = useRef(opts);
  latest.current = opts;
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const [active, setActive] = useState<'move' | 'resize' | null>(null);

  const stopFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  const end = useCallback((p: Press) => {
    if (press.current !== p) return;
    stopFrame();
    press.current = null;
    p.cleanup();
    if (p.active) {
      setActive(null);
      latest.current.onGestureEnd?.();
    }
  }, []);

  /** Writes the pending pointer position as absolute rects from the gesture start. */
  const apply = useCallback(
    (p: Press) => {
      const current = p.pending;
      p.pending = null;
      if (!current || !p.active) return;
      const { doc, camera } = latest.current;
      const delta = { x: (current.x - p.start.x) / camera.zoom, y: (current.y - p.start.y) / camera.zoom };
      // Objects deleted by someone else mid-gesture are skipped.
      const live = [...p.startRects].filter(([id]) => doc.getMap('objects').has(id));
      if (live.length === 0) {
        end(p);
        return;
      }
      if (p.kind === 'move') {
        moveObjects(doc, new Map(live.map(([id, r]) => [id, { x: r.x + delta.x, y: r.y + delta.y }])));
        return;
      }
      const box = p.box;
      const handle = p.handle;
      if (!box || !handle) return;
      const specs = live.map(([id]) => getObjectType(p.types.get(id) ?? ''));
      const aspect = p.shift || specs.some((s) => s?.aspectLocked);
      const to = resizeRect(box, handle, delta, aspect);
      let scale: Point;
      if (aspect) {
        const s = handle === 'n' || handle === 's' ? to.height / box.height : to.width / box.width;
        scale = { x: s, y: s };
      } else {
        scale = { x: box.width > 0 ? to.width / box.width : 1, y: box.height > 0 ? to.height / box.height : 1 };
      }
      const resizable = live.filter((_, i) => specs[i]?.resizable);
      const clamped = clampScale(
        scale,
        resizable.map(([, r]) => r),
        resizable.map(([id]) => getObjectType(p.types.get(id) ?? '')?.minSize ?? 0),
        MAX_OBJECT_SIZE_WORLD,
        aspect,
      );
      const finalBox = scaleFromHandle(box, handle, clamped);
      const rects = new Map<string, Rect>();
      live.forEach(([id, r], i) => {
        const scaled = scaleWithin(r, box, finalBox);
        if (specs[i]?.resizable) rects.set(id, scaled);
        else {
          // Fixed-size objects keep their size and follow their scaled centre.
          const cx = scaled.x + scaled.width / 2;
          const cy = scaled.y + scaled.height / 2;
          rects.set(id, { x: cx - r.width / 2, y: cy - r.height / 2, width: r.width, height: r.height });
        }
      });
      resizeObjects(doc, rects);
    },
    [end],
  );

  const activate = (p: Press) => {
    const { doc } = latest.current;
    const current = objectsSnapshot(doc).filter((o) => p.ids.includes(o.id));
    if (current.length === 0) return false;
    p.startRects = new Map(current.map((o) => [o.id, objectBounds(o)]));
    p.types = new Map(current.map((o) => [o.id, o.type]));
    p.box = unionRects([...p.startRects.values()]);
    p.active = true;
    setActive(p.kind);
    latest.current.onGestureStart?.();
    if (p.kind === 'move') bringObjectsToFront(doc, [...p.startRects.keys()]);
    return true;
  };

  const begin = (e: AnyPointerEvent, init: Pick<Press, 'kind' | 'handle' | 'objectId' | 'ids'>) => {
    const element = e.currentTarget as Element;
    const p: Press = {
      ...init,
      pointerId: e.pointerId,
      element,
      start: { x: e.clientX, y: e.clientY },
      active: false,
      startRects: new Map(),
      types: new Map(),
      box: null,
      shift: e.shiftKey,
      pending: null,
      cleanup: () => {},
    };
    const onMove = (ev: Event) => {
      const pe = ev as PointerEvent;
      if (press.current !== p || pe.pointerId !== p.pointerId) return;
      p.shift = pe.shiftKey;
      if (!p.active) {
        if (!latest.current.canEdit) return;
        if (Math.hypot(pe.clientX - p.start.x, pe.clientY - p.start.y) < DRAG_THRESHOLD_PX) return;
        if (!activate(p)) {
          end(p);
          return;
        }
      } else if (!latest.current.canEdit) {
        end(p);
        return;
      }
      p.pending = { x: pe.clientX, y: pe.clientY };
      frame.current ??= requestAnimationFrame(() => {
        frame.current = null;
        apply(p);
      });
    };
    const onUp = (ev: Event) => {
      const pe = ev as PointerEvent;
      if (press.current !== p || pe.pointerId !== p.pointerId) return;
      if (p.active) {
        stopFrame();
        apply(p);
      } else if (p.objectId !== null) {
        latest.current.selection.click(p.objectId);
      }
      end(p);
    };
    const onCancel = (ev: Event) => {
      const pe = ev as PointerEvent;
      if (press.current !== p || pe.pointerId !== p.pointerId) return;
      end(p);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    element.addEventListener('lostpointercapture', onCancel);
    p.cleanup = () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('lostpointercapture', onCancel);
    };
    press.current = p;
    try {
      element.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
  };

  const onObjectPointerDown = useCallback((e: AnyPointerEvent, id: string) => {
    if (e.button !== PRIMARY_BUTTON || press.current) return;
    const { selection } = latest.current;
    if (e.shiftKey) {
      // Shift-click adds or removes the object; it never starts a drag.
      selection.toggle(id);
      return;
    }
    const alreadySelected = selection.ids.has(id);
    if (!alreadySelected) selection.click(id);
    begin(e, {
      kind: 'move',
      handle: null,
      // A click (no drag) on a member of a multi-selection selects just it.
      objectId: id,
      ids: alreadySelected ? [...selection.ids] : [id],
    });
  }, []);

  const onHandlePointerDown = useCallback((e: AnyPointerEvent, handle: Handle) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || press.current || !latest.current.canEdit) return;
    const { selection, snapshot } = latest.current;
    const ids = [...selection.ids];
    const resizable = snapshot.some((o) => selection.ids.has(o.id) && getObjectType(o.type)?.resizable);
    if (!resizable) return;
    e.preventDefault();
    begin(e, { kind: 'resize', handle, objectId: null, ids });
  }, []);

  useEffect(
    () => () => {
      const p = press.current;
      if (p) end(p);
    },
    [end],
  );

  return { onObjectPointerDown, onHandlePointerDown, active };
}
