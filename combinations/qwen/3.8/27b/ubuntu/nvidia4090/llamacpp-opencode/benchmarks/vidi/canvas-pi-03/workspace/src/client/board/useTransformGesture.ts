import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '@/shared/board-model';
import { objectBounds, moveObjects, resizeObjects, bringObjectsToFront } from '@/shared/board-model';
import {
  resizeRect,
  clampScale,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '@/shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '@/shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { Measurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { setTextWidthFixed } from '@/shared/objects/text';
import type { Selection } from './useSelection';

/**
 * The board-level transform gesture (story 7, sel.transform): group move and
 * bounding-box resize. One gesture at a time, driven by window-level
 * pointermove/up/cancel listeners (robust to the element under the pointer
 * changing mid-drag).
 *
 *  - onObjectPointerDown: selects (click) or toggles (shift-click) the
 *    object; after DRAG_THRESHOLD_PX of movement the selection's start rects
 *    are captured, `bringObjectsToFront` is applied and every rAF frame
 *    writes ABSOLUTE world positions (`start + delta/zoom`) via
 *    `moveObjects`. Absolute writes keep concurrent clients convergent.
 *  - onHandlePointerDown: `resizeRect` on the selection's bounding box,
 *    clamped by `clampScale` (per-type minSize, MAX_OBJECT_SIZE_WORLD), then
 *    `scaleWithin` per object and `resizeObjects`. Aspect is locked when any
 *    selected spec is aspectLocked or Shift is held.
 *
 * rAF-throttled writes are flushed synchronously on pointerup/pointercancel
 * so the gesture always ends exactly at the last shown state. Objects
 * pruned (deleted remotely) mid-gesture are skipped by the model calls.
 * `canEdit === false` (story 4 load failure) allows selection but ignores
 * the transform entirely.
 */

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Story 9: width measurer for the single-text width gesture. */
  measure: Measurer;
  /** Exactly once per gesture (story 8 undo boundaries). */
  onGestureStart?(): void;
  /** Exactly once per gesture, on pointerup/pointercancel. */
  onGestureEnd?(): void;
}

export interface TransformGesture {
  onObjectPointerDown(e: ReactPointerEvent<Element>, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  /** Ids of the objects currently being dragged (cursor feedback), if any. */
  draggingIds: ReadonlySet<string> | null;
}

interface GestureState {
  /**
   * 'move' / 'resize' are story 7; 'textWidth' (story 9) is a single-text
   * e/w handle drag that sets a fixed width and rewraps (text.fixed_width).
   */
  kind: 'move' | 'resize' | 'textWidth';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  active: boolean;
  /** move: the ids to drag (set at pointerdown, finalised at threshold). */
  ids: string[];
  /** move: captured at threshold crossing (top-lefts in world units). */
  startRects: ReadonlyMap<string, Rect> | null;
  /** resize: captured at handle pointerdown. */
  handle: Handle | null;
  aspect: boolean;
  startBox: Rect | null;
  minSizes: number[] | null;
  pending: ReadonlyMap<string, Point | Rect> | null;
  /** textWidth: the latest target {x, y, width} for the single text. */
  pendingText: { id: string; x: number; y: number; width: number } | null;
  /** textWidth: the box captured at handle pointerdown. */
  textStartX: number;
  textStartY: number;
  textStartWidth: number;
  rafId: number | null;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGesture {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const gestureRef = useRef<GestureState | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string> | null>(null);

  // Keep one listener set alive for the current gesture.
  const listenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  const removeListeners = useCallback((): void => {
    const l = listenersRef.current;
    if (!l) return;
    window.removeEventListener('pointermove', l.move);
    window.removeEventListener('pointerup', l.up);
    window.removeEventListener('pointercancel', l.cancel);
    listenersRef.current = null;
  }, []);

  const writePending = useCallback((): void => {
    const g = gestureRef.current;
    if (!g) return;
    const { doc, measure } = optsRef.current;
    if (g.kind === 'textWidth') {
      // Story 9: write the anchor (x moves with a 'w' drag) and the fixed
      // width, then rewrap (height follows the content). x/y never move on
      // a re-measure (text.anchor).
      if (g.pendingText !== null) {
        const t = g.pendingText;
        moveObjects(doc, new Map<string, Point>([[t.id, { x: t.x, y: t.y }]]));
        setTextWidthFixed(doc, t.id, t.width);
        remeasureTextBox(doc, t.id, measure);
      }
      g.pendingText = null;
      return;
    }
    if (g.pending === null) return;
    if (g.kind === 'move') {
      moveObjects(doc, g.pending as ReadonlyMap<string, Point>);
    } else {
      resizeObjects(doc, g.pending as ReadonlyMap<string, Rect>);
    }
    g.pending = null;
  }, []);

  const flushPending = useCallback((): void => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.rafId !== null) {
      cancelAnimationFrame(g.rafId);
      g.rafId = null;
    }
    writePending();
  }, [writePending]);

  const endGesture = useCallback(
    (e?: PointerEvent): void => {
      const g = gestureRef.current;
      if (!g) return;
      if (e !== undefined) {
        try {
          (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
        } catch {
          /* capture may already be gone */
        }
      }
      const started = g.active;
      flushPending();
      removeListeners();
      gestureRef.current = null;
      setDraggingIds(null);
      // Exactly once per gesture: a plain click (threshold never crossed) is
      // not a gesture, so onGestureEnd fires only when it actually started.
      if (started) optsRef.current.onGestureEnd?.();
    },
    [flushPending, removeListeners],
  );

  const scheduleWrite = useCallback(
    (pending: ReadonlyMap<string, Point> | ReadonlyMap<string, Rect>): void => {
      const g = gestureRef.current;
      if (!g) return;
      g.pending = pending;
      if (g.rafId === null) {
        g.rafId = requestAnimationFrame(() => {
          const st = gestureRef.current;
          if (!st) return;
          st.rafId = null;
          writePending();
        });
      }
    },
    [writePending],
  );

  const scheduleTextWrite = useCallback(
    (pendingText: { id: string; x: number; y: number; width: number }): void => {
      const g = gestureRef.current;
      if (!g) return;
      g.pendingText = pendingText;
      if (g.rafId === null) {
        g.rafId = requestAnimationFrame(() => {
          const st = gestureRef.current;
          if (!st) return;
          st.rafId = null;
          writePending();
        });
      }
    },
    [writePending],
  );

  const handleWindowMove = useCallback(
    (e: PointerEvent): void => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const { camera, snapshot } = optsRef.current;
      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;

      if (g.kind === 'textWidth') {
        // Story 9: single-text e/w handle — width follows the pointer,
        // clamped to [TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD]; the 'w'
        // handle keeps the right edge fixed by moving the anchor x.
        const z = camera.zoom;
        const raw =
          g.handle === 'w'
            ? g.textStartWidth - dx / z
            : g.textStartWidth + dx / z;
        const width = Math.min(
          Math.max(raw, TEXT_MIN_WIDTH_WORLD),
          MAX_OBJECT_SIZE_WORLD,
        );
        const x = g.handle === 'w' ? g.textStartX + (g.textStartWidth - width) : g.textStartX;
        scheduleTextWrite({ id: g.ids[0], x, y: g.textStartY, width });
        return;
      }
      if (g.kind === 'move') {
        if (!g.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still "Pressed"
          // Threshold crossed: this is now a drag of the selection.
          const startRects = new Map<string, Rect>();
          for (const o of snapshot) {
            if (g.ids.includes(o.id)) startRects.set(o.id, objectBounds(o));
          }
          if (startRects.size === 0) {
            // All candidates vanished (deleted remotely) before the drag.
            endGesture();
            return;
          }
          g.ids = [...startRects.keys()];
          g.startRects = startRects;
          g.active = true;
          bringObjectsToFront(optsRef.current.doc, g.ids);
          optsRef.current.onGestureStart?.();
          setDraggingIds(new Set(g.ids));
        }
        const z = camera.zoom;
        const start = g.startRects;
        if (!start) return;
        const pending = new Map<string, Point>();
        for (const [id, r] of start) {
          pending.set(id, { x: r.x + dx / z, y: r.y + dy / z });
        }
        scheduleWrite(pending);
      } else if (g.kind === 'resize') {
        const startBox = g.startBox;
        const startRects = g.startRects;
        const handle = g.handle;
        if (!startBox || !startRects || !handle) return;
        const z = camera.zoom;
        const delta = { x: dx / z, y: dy / z };
        const raw = resizeRect(startBox, handle, delta, g.aspect);
        const sx = startBox.width > 0 ? raw.width / startBox.width : 1;
        const sy = startBox.height > 0 ? raw.height / startBox.height : 1;
        const clamped = clampScale(
          { x: sx, y: sy },
          [...startRects.values()],
          g.minSizes ?? [],
          MAX_OBJECT_SIZE_WORLD,
        );
        const hasW = handle === 'w' || handle === 'nw' || handle === 'sw';
        const hasN = handle === 'n' || handle === 'ne' || handle === 'nw';
        const finalBox: Rect = {
          x: hasW ? startBox.x + startBox.width - startBox.width * clamped.x : startBox.x,
          y: hasN ? startBox.y + startBox.height - startBox.height * clamped.y : startBox.y,
          width: startBox.width * clamped.x,
          height: startBox.height * clamped.y,
        };
        const pending = new Map<string, Rect>();
        for (const [id, r] of startRects) {
          pending.set(id, scaleWithin(r, startBox, finalBox));
        }
        scheduleWrite(pending);
      }
    },
    [endGesture, scheduleWrite, scheduleTextWrite],
  );

  const installListeners = useCallback((): void => {
    removeListeners();
      const move = (e: PointerEvent): void => handleWindowMove(e);
      const up = (e: PointerEvent): void => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) return;
        endGesture(e);
      };
      const cancel = (e: PointerEvent): void => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) return;
        endGesture(e);
      };
      listenersRef.current = { move, up, cancel };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [endGesture, handleWindowMove, removeListeners],
  );


  // Safety: a gesture must not outlive the component.
  useEffect(
    () => () => {
      const g = gestureRef.current;
      if (g?.rafId !== null && g?.rafId !== undefined) cancelAnimationFrame(g.rafId);
      removeListeners();
    },
    [removeListeners],
  );

  const onObjectPointerDown = useCallback(
    (e: ReactPointerEvent<Element>, id: string): void => {
      if (e.button !== 0) return;
      // The board must not pan when a press starts on an object (sticky.no_pan).
      e.stopPropagation();
      const { selection, canEdit } = optsRef.current;
      if (selection.editingId === id) return; // the editor owns the pointer

      // Selection (always allowed, even when the board is locked):
      // plain click replaces, shift-click toggles.
      let ids: string[];
      if (e.shiftKey) {
        const next = new Set(selection.ids);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selection.toggle(id);
        ids = [...next];
      } else if (selection.ids.size > 0 && selection.ids.has(id)) {
        // Dragging a member of an existing selection keeps the group: the
        // whole selection moves (PRD: "dragging a selected object moves the
        // whole selection"). No click dispatch — it would collapse the set.
        ids = [...selection.ids];
      } else {
        // sel.drag_unselected: dragging an unselected object selects just it
        // and moves it.
        selection.click(id);
        ids = [id];
      }

      if (!canEdit || gestureRef.current !== null) return; // select-only when locked

      const g: GestureState = {
        kind: 'move',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        active: false,
        ids,
        startRects: null,
        handle: null,
        aspect: false,
        startBox: null,
        minSizes: null,
        pending: null,
        pendingText: null,
        textStartX: 0,
        textStartY: 0,
        textStartWidth: 0,
        rafId: null,
      };
      gestureRef.current = g;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom / unsupported */
      }
      installListeners();
    },
    [installListeners],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle): void => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const { selection, snapshot, canEdit } = optsRef.current;
      if (!canEdit || gestureRef.current !== null || selection.ids.size === 0) return;

      const objs = snapshot.filter((o) => selection.ids.has(o.id));
      if (!objs.some((o) => getObjectType(o.type)?.resizable)) return;

      // Story 9: a single text object with an e/w handle gets a fixed-width
      // drag (text.fixed_width) instead of a bounding-box resize — height
      // always follows the content, so there is no scale to compute.
      const horizontal =
        handle === 'e' || handle === 'w'
          ? objs.length === 1 && getObjectType(objs[0].type)?.handles === 'horizontal'
          : false;
      if (horizontal) {
        const o = objs[0];
        const b = objectBounds(o);
        const g: GestureState = {
          kind: 'textWidth',
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          active: true,
          ids: [o.id],
          startRects: null,
          handle,
          aspect: false,
          startBox: b,
          minSizes: null,
          pending: null,
          pendingText: null,
          textStartX: b.x,
          textStartY: b.y,
          textStartWidth: Math.max(b.width, 0),
          rafId: null,
        };
        gestureRef.current = g;
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* jsdom / unsupported */
        }
        optsRef.current.onGestureStart?.();
        setDraggingIds(new Set(g.ids));
        installListeners();
        return;
      }

      const startBox = unionRects(objs.map((o) => objectBounds(o)));
      if (!startBox) return;

      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      let aspect = e.shiftKey;
      for (const o of objs) {
        const spec = getObjectType(o.type);
        startRects.set(o.id, objectBounds(o));
        minSizes.push(spec?.minSize ?? 0);
        if (spec?.aspectLocked) aspect = true;
      }

      const g: GestureState = {
        kind: 'resize',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        active: true,
        ids: objs.map((o) => o.id),
        startRects,
        handle,
        aspect,
        startBox,
        minSizes,
        pending: null,
        pendingText: null,
        textStartX: 0,
        textStartY: 0,
        textStartWidth: 0,
        rafId: null,
      };
      gestureRef.current = g;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom / unsupported */
      }
      optsRef.current.onGestureStart?.();
      setDraggingIds(new Set(g.ids));
      installListeners();
    },
    [installListeners],
  );

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
