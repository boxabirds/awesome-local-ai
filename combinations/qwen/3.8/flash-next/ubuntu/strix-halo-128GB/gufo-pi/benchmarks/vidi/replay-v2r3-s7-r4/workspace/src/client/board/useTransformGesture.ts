import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { Handle } from '../../shared/geometry';
import { resizeRect, clampScale, scaleWithin, unionRects } from '../../shared/geometry';
import type { Point, Rect } from '../../shared/geometry';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
} from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { useSelection } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Story 8 undo boundaries; called exactly once per gesture. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

type Mode = 'press' | 'move' | 'resize';

interface Gesture {
  pointerId: number;
  mode: Mode;
  startClientX: number;
  startClientY: number;
  zoom: number;
  ids: string[];
  startRects: Map<string, Rect>;
  handle: Handle | null;
  bboxStart: Rect | null;
  aspect: boolean;
  minSizes: number[];
  raf: number | null;
  started: boolean;
  /** When pressing (not dragging) an already-selected member, collapse to it. */
  collapseId: string | null;
}

const NO_DRAG: ReadonlySet<string> = new Set<string>();

/** Reposition a rect from a clamped size using the handle's fixed anchor. */
function rectFromScale(start: Rect, handle: Handle, w: number, h: number): Rect {
  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle.includes('n');
  const bottom = handle.includes('s');
  const horizontal = left || right;
  const vertical = top || bottom;
  let x: number;
  let y: number;
  if (horizontal && vertical) {
    x = left ? start.x + start.width - w : start.x;
    y = top ? start.y + start.height - h : start.y;
  } else if (horizontal) {
    x = left ? start.x + start.width - w : start.x;
    y = start.y + (start.height - h) / 2;
  } else if (vertical) {
    x = start.x + (start.width - w) / 2;
    y = top ? start.y + start.height - h : start.y;
  } else {
    x = start.x;
    y = start.y;
  }
  return { x, y, width: w, height: h };
}

/**
 * Generic group move and bounding-box resize for the current selection
 * (sel.transform). Positions are written as absolute values computed from the
 * rects captured at gesture start, so concurrent remote edits converge.
 */
export function useTransformGesture(opts: TransformGestureOptions) {
  const live = useRef(opts);
  live.current = opts;
  const gesture = useRef<Gesture | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(NO_DRAG);

  const impl = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  const applyMoveFrame = () => {
    const g = gesture.current;
    if (!g) return;
    g.raf = null;
    const positions = new Map<string, Point>();
    for (const id of g.ids) {
      const r = g.startRects.get(id);
      if (!r) continue;
      positions.set(id, {
        x: r.x + (latestX.current - g.startClientX) / g.zoom,
        y: r.y + (latestY.current - g.startClientY) / g.zoom,
      });
    }
    moveObjects(live.current.doc, positions);
  };

  const applyResizeFrame = () => {
    const g = gesture.current;
    if (!g || !g.handle || !g.bboxStart) return;
    g.raf = null;
    const bbox = g.bboxStart;
    const dx = (latestX.current - g.startClientX) / g.zoom;
    const dy = (latestY.current - g.startClientY) / g.zoom;
    const resized = resizeRect(bbox, g.handle, { x: dx, y: dy }, g.aspect);
    const rects = [...g.ids].map((id) => g.startRects.get(id)!).filter(Boolean);
    const scale = {
      x: bbox.width !== 0 ? resized.width / bbox.width : 1,
      y: bbox.height !== 0 ? resized.height / bbox.height : 1,
    };
    const clamped = clampScale(scale, rects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = rectFromScale(
      bbox,
      g.handle,
      bbox.width * clamped.x,
      bbox.height * clamped.y,
    );
    const next = new Map<string, Rect>();
    for (const id of g.ids) {
      const r = g.startRects.get(id);
      if (!r) continue;
      next.set(id, scaleWithin(r, bbox, to));
    }
    resizeObjects(live.current.doc, next);
  };

  // Latest client coordinates, so a coalesced rAF frame uses the newest value.
  const latestX = useRef(0);
  const latestY = useRef(0);

  const finish = (applyFinal: boolean) => {
    const g = gesture.current;
    if (!g) return;
    if (g.raf != null) cancelAnimationFrame(g.raf);
    const started = g.started;
    const mode = g.mode;
    const collapse = g.collapseId;
    gesture.current = null;
    detachWindow();
    setDraggingIds(NO_DRAG);
    if (started) {
      if (applyFinal) {
        if (mode === 'resize') applyResizeFrame();
        else applyMoveFrame();
      }
      live.current.onGestureEnd?.();
    } else if (applyFinal && collapse) {
      // A pure press on a group member selects just that member.
      live.current.selection.click(collapse);
    }
  };

  impl.current = {
    move: (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      latestX.current = e.clientX;
      latestY.current = e.clientY;

      if (!g.started) {
        if (Math.hypot(e.clientX - g.startClientX, e.clientY - g.startClientY) < DRAG_THRESHOLD_PX) {
          return;
        }
        g.started = true;
        live.current.onGestureStart?.();
        if (g.handle) {
          g.mode = 'resize';
        } else {
          g.mode = 'move';
          bringObjectsToFront(live.current.doc, g.ids);
          setDraggingIds(new Set(g.ids));
        }
      }

      if (g.raf === null) {
        g.raf = requestAnimationFrame(() => {
          if (g.mode === 'resize') applyResizeFrame();
          else applyMoveFrame();
        });
      }
    },
    up: (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      latestX.current = e.clientX;
      latestY.current = e.clientY;
      finish(true);
    },
    cancel: () => {
      // A cancelled gesture keeps the last applied state (no final write).
      finish(false);
    },
  };

  const winMove = useRef((e: PointerEvent) => impl.current?.move(e));
  const winUp = useRef((e: PointerEvent) => impl.current?.up(e));
  const winCancel = useRef(() => impl.current?.cancel());

  function attachWindow() {
    window.addEventListener('pointermove', winMove.current);
    window.addEventListener('pointerup', winUp.current);
    window.addEventListener('pointercancel', winCancel.current);
  }
  function detachWindow() {
    window.removeEventListener('pointermove', winMove.current);
    window.removeEventListener('pointerup', winUp.current);
    window.removeEventListener('pointercancel', winCancel.current);
  }

  const snapshotRects = (snap: readonly ObjectSnapshot[], ids: string[]): Map<string, Rect> => {
    const byId = new Map(snap.map((o) => [o.id, o]));
    const rects = new Map<string, Rect>();
    for (const id of ids) {
      const o = byId.get(id);
      if (o) rects.set(id, objectBounds(o));
    }
    return rects;
  };

  const onObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const o = live.current;
    // Shift+click toggles membership, never drags (works even when read-only).
    if (e.shiftKey) {
      o.selection.toggle(id);
      return;
    }
    // Read-only: selection still works, but a press never starts a transform.
    if (!o.canEdit) {
      o.selection.click(id);
      return;
    }
    const alreadySelected = o.selection.ids.has(id);
    const ids = alreadySelected ? [...o.selection.ids] : [id];
    if (!alreadySelected) o.selection.click(id);

    gesture.current = {
      pointerId: e.pointerId,
      mode: 'press',
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: o.camera.zoom || 1,
      ids,
      startRects: snapshotRects(o.snapshot, ids),
      handle: null,
      bboxStart: null,
      aspect: false,
      minSizes: [],
      raf: null,
      started: false,
      collapseId: alreadySelected ? id : null,
    };
    latestX.current = e.clientX;
    latestY.current = e.clientY;
    attachWindow();
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation();
    const o = live.current;
    if (!o.canEdit) return;
    const ids = [...o.selection.ids];
    if (ids.length === 0) return;

    const byId = new Map(o.snapshot.map((s) => [s.id, s]));
    const specs = ids
      .map((id) => byId.get(id))
      .filter((obj): obj is ObjectSnapshot => !!obj)
      .map((obj) => getObjectType(obj.type))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!specs.some((s) => s.resizable)) return;
    const aspect = e.shiftKey || specs.some((s) => s.aspectLocked);

    const startRects = snapshotRects(o.snapshot, ids);
    const bbox = unionRects([...startRects.values()]);
    if (!bbox) return;

    const minSizes = ids.map((id) => {
      const obj = byId.get(id);
      return obj ? getObjectType(obj.type)?.minSize ?? 0 : 0;
    });

    gesture.current = {
      pointerId: e.pointerId,
      mode: 'press',
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: o.camera.zoom || 1,
      ids,
      startRects,
      handle,
      bboxStart: bbox,
      aspect,
      minSizes,
      raf: null,
      started: false,
      collapseId: null,
    };
    latestX.current = e.clientX;
    latestY.current = e.clientY;
    attachWindow();
  }, []);

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
