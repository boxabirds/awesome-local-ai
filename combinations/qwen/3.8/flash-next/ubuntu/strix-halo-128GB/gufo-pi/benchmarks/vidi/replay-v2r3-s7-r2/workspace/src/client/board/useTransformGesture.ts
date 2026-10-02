/**
 * Shared transform gesture (story 7).
 *
 * One gesture drives both group moves and bounding-box resizes for any object
 * type. It is the only writer of positions and sizes while the pointer is down:
 * every object of the selection is measured once at the start, and each frame
 * writes where the objects should be now. Absolute writes rather than
 * incremental ones are what makes two people dragging the same group converge.
 *
 * The listeners live on the window, not on the objects: bringing a group to the
 * front re-orders the world layer's children, which would drop a pointer capture
 * taken on one of them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { bringObjectsToFront, moveObjects, objectBounds, resizeObjects } from '../../shared/board-model';
import type { Handle, Point, Rect } from '../../shared/geometry';
import { anchoredRect, clampScale, resizeRect, scaleWithin, unionRects } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  /** Only `zoom` is needed: the pointer moves in pixels, the board in units. */
  camera: { zoom: number };
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** Select and start a group move. */
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  /** Start a resize of the selection's bounding box. */
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  /** Ids currently being transformed; used to hide per-object toolbars. */
  activeIds: ReadonlySet<string>;
  /** The selected rectangles as the gesture found them, drawn by the overlay for the
   * whole gesture so it is not recomputed on every frame. Null while idle. */
  frozen: readonly Rect[] | null;
}

interface ActiveGesture {
  kind: 'move' | 'resize';
  pointerId: number;
  handle: Handle | null;
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  zoom: number;
  ids: string[];
  startRects: Map<string, Rect>;
  /** Objects in `ids` order, matching `minSizes`. */
  rects: Rect[];
  minSizes: number[];
  box: Rect | null;
  aspect: boolean;
  started: boolean;
  raf: number | null;
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  const live = useRef(options);
  live.current = options;

  const activeRef = useRef<ActiveGesture | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [frozen, setFrozen] = useState<readonly Rect[] | null>(null);

  const applyFrame = useCallback((a: ActiveGesture) => {
    a.raf = null;
    const zoom = a.zoom || 1;
    const dx = (a.latestClientX - a.startClientX) / zoom;
    const dy = (a.latestClientY - a.startClientY) / zoom;
    const doc = live.current.doc;

    if (a.kind === 'move') {
      const positions = new Map<string, Point>();
      for (const id of a.ids) {
        const start = a.startRects.get(id);
        if (start) positions.set(id, { x: start.x + dx, y: start.y + dy });
      }
      if (positions.size > 0) moveObjects(doc, positions);
      return;
    }

    const box = a.box;
    const handle = a.handle;
    if (!box || !handle) return;

    // `resizeRect` already applies the locked ratio, following the axis the
    // pointer moved along further, and anchors the opposite edge.
    const target = resizeRect(box, handle, { x: dx, y: dy }, a.aspect);
    const wanted = { x: target.width / box.width, y: target.height / box.height };
    const clamped = clampScale(wanted, a.rects, a.minSizes, MAX_OBJECT_SIZE_WORLD);
    let scale = clamped;
    if (a.aspect) {
      // One factor for both axes, stopped by whichever limit binds first.
      const s = Math.abs(wanted.x - 1) >= Math.abs(wanted.y - 1) ? wanted.x : wanted.y;
      const u = s >= 1 ? Math.min(clamped.x, clamped.y) : Math.max(clamped.x, clamped.y);
      scale = { x: u, y: u };
    }
    const to = anchoredRect(box, handle, box.width * scale.x, box.height * scale.y, a.aspect);

    const rects = new Map<string, Rect>();
    for (const id of a.ids) {
      const start = a.startRects.get(id);
      if (start) rects.set(id, scaleWithin(start, box, to));
    }
    if (rects.size > 0) resizeObjects(doc, rects);
  }, []);

  const scheduleFrame = useCallback(
    (a: ActiveGesture) => {
      if (a.raf != null) return; // coalesce a burst of pointermoves into one write
      a.raf = requestAnimationFrame(() => applyFrame(a));
    },
    [applyFrame],
  );

  const detachRef = useRef<() => void>(() => {});

  const finish = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    if (a.raf != null) cancelAnimationFrame(a.raf);
    const hadStarted = a.started;
    activeRef.current = null;
    detachRef.current();
    if (hadStarted) {
      setActiveIds(NO_IDS);
      setFrozen(null);
      live.current.onGestureEnd?.();
    }
  }, []);

  const impl = useRef<{
    move(e: PointerEvent): void;
    up(e: PointerEvent): void;
    cancel(): void;
  } | null>(null);

  // Stable function identities so the listeners can always be removed again.
  const winMoveRef = useRef((e: PointerEvent) => impl.current?.move(e));
  const winUpRef = useRef((e: PointerEvent) => impl.current?.up(e));
  const winCancelRef = useRef(() => impl.current?.cancel());

  impl.current = {
    move: (e: PointerEvent) => {
      const a = activeRef.current;
      if (!a || (e.pointerId !== undefined && a.pointerId !== e.pointerId)) return;
      a.latestClientX = e.clientX;
      a.latestClientY = e.clientY;

      if (!a.started) {
        const dx = e.clientX - a.startClientX;
        const dy = e.clientY - a.startClientY;
        // A small accidental wobble stays a click.
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        a.started = true;
        live.current.onGestureStart?.();
        setActiveIds(new Set(a.ids));
        setFrozen(a.rects.map((r) => ({ ...r })));
        // The moved group comes forward as a whole, once, at the start.
        if (a.kind === 'move') bringObjectsToFront(live.current.doc, a.ids);
      }
      scheduleFrame(a);
    },
    up: (e: PointerEvent) => {
      const a = activeRef.current;
      if (!a || (e.pointerId !== undefined && a.pointerId !== e.pointerId)) return;
      if (a.started) {
        a.latestClientX = e.clientX;
        a.latestClientY = e.clientY;
        if (a.raf != null) {
          cancelAnimationFrame(a.raf);
          a.raf = null;
        }
        // The last frame is applied synchronously: the final position lands
        // exactly under the pointer.
        applyFrame(a);
      }
      finish();
    },
    // A cancelled pointer keeps the last position that was applied.
    cancel: () => finish(),
  };

  detachRef.current = () => {
    window.removeEventListener('pointermove', winMoveRef.current);
    window.removeEventListener('pointerup', winUpRef.current);
    window.removeEventListener('pointercancel', winCancelRef.current);
  };

  useEffect(() => () => detachRef.current(), []);

  const begin = useCallback(
    (kind: 'move' | 'resize', ids: string[], e: React.PointerEvent, handle: Handle | null, aspect: boolean) => {
      const { snapshot } = live.current;
      const startRects = new Map<string, Rect>();
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      for (const id of ids) {
        const obj = snapshot.find((o) => o.id === id);
        if (!obj) continue;
        const rect = objectBounds(obj);
        startRects.set(id, rect);
        rects.push(rect);
        minSizes.push(getObjectType(obj.type)?.minSize ?? 1);
      }
      if (rects.length === 0) return;

      activeRef.current = {
        kind,
        pointerId: e.pointerId,
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        latestClientX: e.clientX,
        latestClientY: e.clientY,
        zoom: live.current.camera.zoom || 1,
        ids: [...startRects.keys()],
        startRects,
        rects,
        minSizes,
        box: kind === 'resize' ? unionRects(rects) : null,
        aspect,
        started: false,
        raf: null,
      };

      detachRef.current();
      window.addEventListener('pointermove', winMoveRef.current);
      window.addEventListener('pointerup', winUpRef.current);
      window.addEventListener('pointercancel', winCancelRef.current);
    },
    [winMoveRef, winUpRef, winCancelRef],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // The board must never pan because a press started on an object.
      e.stopPropagation();

      const { selection, canEdit } = live.current;

      // Shift+click adds or removes, and never drags.
      if (e.shiftKey) {
        selection.toggle(id);
        return;
      }

      // The press selects first, so a click on an unselected object starts a
      // gesture on that object alone, and a click inside the group moves all of it.
      const wasSelected = selection.ids.has(id);
      if (!wasSelected) selection.click(id);

      if (!canEdit) return; // read-only: selection works, transforms do not

      const ids = wasSelected ? [...selection.ids] : [id];
      begin('move', ids, e, null, false);
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation(); // handles are drawn over the board, which would pan

      const { selection, snapshot, canEdit } = live.current;
      if (!canEdit) return;

      const ids = [...selection.ids];
      if (ids.length === 0) return;
      const selected = snapshot.filter((obj) => ids.includes(obj.id));
      if (selected.length === 0) return;
      if (!selected.some((obj) => getObjectType(obj.type)?.resizable === true)) return;

      // Sticky notes keep their square shape; Shift pins the ratio of anything.
      const aspect = selected.some((obj) => getObjectType(obj.type)?.aspectLocked === true) || e.shiftKey;
      begin('resize', ids, e, handle, aspect);
    },
    [begin],
  );

  return { onObjectPointerDown, onHandlePointerDown, activeIds, frozen };
}
