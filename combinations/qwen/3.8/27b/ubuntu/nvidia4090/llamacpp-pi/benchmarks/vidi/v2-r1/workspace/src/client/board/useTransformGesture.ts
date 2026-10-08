// useTransformGesture (story 7, sel.transform): the one generic gesture that
// moves and resizes any selection, for any registered object type.
//
//  - Pressing an object: below DRAG_THRESHOLD_PX a release selects it
//    (click); at or beyond it the gesture starts — an unselected object is
//    selected first (sel.drag_unselected), the selection is raised in one
//    `bringObjectsToFront`, and every move writes *absolute* positions
//    `start + delta` (key decision 1: no per-frame accumulation, so
//    concurrent remote moves converge to the last writer).
//  - Pressing a bounding-box handle: the resize keeps the opposite corner or
//    edge anchored. `resizeRect` produces the candidate box (aspect-locked
//    when any selected type is aspect-locked or Shift is held), `clampScale`
//    pulls it back so no object crosses its type's minSize or
//    MAX_OBJECT_SIZE_WORLD (the whole selection stops when the first object
//    reaches a limit — key decision 2), and `scaleWithin` re-maps every
//    object (sizes *and* gaps) into the final box.
//  - Writes are throttled with requestAnimationFrame; a pointerup flushes the
//    pending write (the grabbed point ends exactly under the pointer), a
//    pointercancel discards it (the last applied position is kept).
//
// `onGestureStart`/`onGestureEnd` fire exactly once per gesture that crossed
// the threshold (story 8 will use them as undo boundaries).

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  bringObjectsToFront,
  getObject,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { setTextWidthFixed } from '../../shared/objects/text';
import {
  anchoredBox,
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { ObjectPointerEvent } from '../objects/registry';
import type { SelectionApi } from './useSelection';

interface GestureOpts {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface ObjectPress {
  kind: 'object';
  pointerId: number;
  id: string;
  startClient: Point;
  phase: 'pressed' | 'moving';
  /** Bounds of every moved object at threshold crossing (null before). */
  startRects: Map<string, Rect> | null;
}

interface HandlePress {
  kind: 'handle';
  pointerId: number;
  handle: Handle;
  startClient: Point;
  phase: 'pressed' | 'resizing';
  startBox: Rect;
  startRects: Map<string, Rect>;
  /** Per-object minimum size, parallel to startRects iteration order. */
  minSizes: number[];
  aspectLocked: boolean;
}

type Press = ObjectPress | HandlePress;

type Pending =
  | { kind: 'move'; positions: Map<string, Point> }
  | { kind: 'resize'; rects: Map<string, Rect> };

export function useTransformGesture(opts: GestureOpts): {
  onObjectPointerDown(e: ObjectPointerEvent, id: string): void;
  onHandlePointerDown(e: ObjectPointerEvent, handle: Handle): void;
} {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const pressRef = useRef<Press | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const rafRef = useRef(0);
  const startedRef = useRef(false);

  const apply = (p: Pending) => {
    const { doc } = optsRef.current;
    if (p.kind === 'move') {
      moveObjects(doc, p.positions);
      return;
    }
    // Story 9: objects whose type only supports horizontal handles (text)
    // never get a direct height change. They are repositioned (x, y) and,
    // when their width is fixed (or it is the only selected object, in which
    // case the drag turns it fixed), their scaled width is written via
    // setTextWidthFixed. useTextBoxSync re-measures the wrapped height
    // locally after the local width change.
    const generic = new Map<string, Rect>();
    const horizontal = new Map<string, Rect>();
    for (const [id, r] of p.rects) {
      const obj = getObject(doc, id);
      const type = obj?.get('type');
      if (typeof type === 'string' && getObjectType(type)?.handles === 'horizontal') {
        horizontal.set(id, r);
      } else {
        generic.set(id, r);
      }
    }
    if (generic.size > 0) resizeObjects(doc, generic);
    for (const [id, r] of horizontal) {
      moveObjects(doc, new Map([[id, { x: r.x, y: r.y }]]));
      const obj = getObject(doc, id);
      if (obj === undefined) continue;
      const widthMode = obj.get('widthMode');
      const single = p.rects.size === 1;
      if (single || widthMode === 'fixed') {
        const width = Math.min(Math.max(r.width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
        setTextWidthFixed(doc, id, width);
      }
    }
  };

  const cancelScheduled = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingRef.current = null;
  };

  const schedule = (p: Pending) => {
    pendingRef.current = p;
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) apply(pending);
    });
  };

  // Window-level pointer listeners: the element that received the pointerdown
  // captures the pointer (best effort), so moves and ups arrive at window
  // regardless of what the pointer slides over.
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      const { camera, canEdit, selection, snapshot, onGestureStart } = optsRef.current;
      const dx = e.clientX - press.startClient.x;
      const dy = e.clientY - press.startClient.y;

      if (press.kind === 'object') {
        if (press.phase === 'pressed') {
          // The edit lock (canEdit false) never turns a press into a move.
          if (!canEdit || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          // sel.drag_unselected: dragging an unselected object selects just
          // it; a selected one moves the whole selection.
          const selected = selection.ids;
          const ids: string[] = selected.has(press.id) ? [...selected] : [press.id];
          if (!selected.has(press.id)) selection.click(press.id);
          const startRects = new Map<string, Rect>();
          for (const id of ids) {
            const obj = snapshot.find((o) => o.id === id);
            if (obj) startRects.set(id, objectBounds(obj));
          }
          press.phase = 'moving';
          press.startRects = startRects;
          bringObjectsToFront(optsRef.current.doc, [...startRects.keys()]);
          startedRef.current = true;
          onGestureStart?.();
        }
        if (press.phase === 'moving' && press.startRects !== null) {
          const positions = new Map<string, Point>();
          for (const [id, rect] of press.startRects) {
            // Absolute write: start + delta, divided by the live zoom so the
            // grabbed point stays under the pointer at any zoom level.
            positions.set(id, {
              x: rect.x + dx / camera.zoom,
              y: rect.y + dy / camera.zoom,
            });
          }
          schedule({ kind: 'move', positions });
        }
      } else {
        // Handle resize.
        if (press.phase === 'pressed') {
          if (!canEdit || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          press.phase = 'resizing';
          startedRef.current = true;
          onGestureStart?.();
        }
        if (press.phase === 'resizing') {
          const delta: Point = { x: dx / camera.zoom, y: dy / camera.zoom };
          const rectsArr: Rect[] = [];
          let i = 0;
          for (const r of press.startRects.values()) {
            rectsArr.push(r);
            i += 1;
          }
          const aspect = press.aspectLocked || e.shiftKey;
          const candidate = resizeRect(press.startBox, press.handle, delta, aspect);
          const scale: Point = {
            x: press.startBox.width > 0 ? candidate.width / press.startBox.width : 1,
            y: press.startBox.height > 0 ? candidate.height / press.startBox.height : 1,
          };
          const clamped = clampScale(scale, rectsArr, press.minSizes, MAX_OBJECT_SIZE_WORLD);
          const to = anchoredBox(
            press.startBox,
            press.handle,
            press.startBox.width * clamped.x,
            press.startBox.height * clamped.y,
          );
          const rects = new Map<string, Rect>();
          for (const [id, r] of press.startRects) {
            rects.set(id, scaleWithin(r, press.startBox, to));
          }
          schedule({ kind: 'resize', rects });
        }
      }
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      pressRef.current = null;
      const { selection, onGestureEnd } = optsRef.current;
      if (cancelled) {
        // Keep the last applied position: drop whatever is pending.
        cancelScheduled();
      } else if (pendingRef.current !== null) {
        const pending = pendingRef.current;
        // Flush the pending write so the final position matches the pointer
        // exactly (no frame boundary between the last move and the up).
        if (rafRef.current !== 0) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        pendingRef.current = null;
        apply(pending);
      }
      if (press.kind === 'object' && press.phase === 'pressed') {
        // A short press without movement selects the object (click).
        selection.click(press.id);
      }
      if (startedRef.current) {
        startedRef.current = false;
        onGestureEnd?.();
      }
    };

    const onPointerUp = (e: PointerEvent) => finish(e, false);
    const onPointerCancel = (e: PointerEvent) => finish(e, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      pressRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  const onObjectPointerDown = (e: ObjectPointerEvent, id: string) => {
    const { selection } = optsRef.current;
    if (pressRef.current !== null) return; // one active gesture at a time
    // Only ignore the press on the note being edited itself (its textarea
    // owns the pointer). A press on any *other* object ends the edit through
    // the editor's outside-pointerdown (which clears the selection) and then
    // proceeds as a fresh press.
    if (selection.editingId === id) return;
    // Shift-click toggles membership without starting a gesture (sel.shift_toggle).
    if (e.shiftKey) {
      selection.toggle(id);
      return;
    }
    pressRef.current = {
      kind: 'object',
      pointerId: e.pointerId,
      id,
      startClient: { x: e.clientX, y: e.clientY },
      phase: 'pressed',
      startRects: null,
    };
  };

  const onHandlePointerDown = (e: ObjectPointerEvent, handle: Handle) => {
    const { selection, snapshot, canEdit } = optsRef.current;
    if (pressRef.current !== null) return;
    // The editor's outside-pointerdown has just cleared the selection if the
    // user was editing; the stale editingId must not start a resize.
    if (selection.editingId !== null) return;
    if (!canEdit) return; // story 4 edit lock
    const selected = snapshot.filter((o) => selection.ids.has(o.id));
    if (selected.length === 0) return;
    const minSizes: number[] = [];
    let aspectLocked = false;
    let resizable = false;
    for (const o of selected) {
      const spec = getObjectType(o.type);
      if (!spec) return; // defensively: unknown types are not selectable
      minSizes.push(spec.minSize);
      if (spec.aspectLocked) aspectLocked = true;
      if (spec.resizable) resizable = true;
    }
    if (!resizable) return; // handles are hidden in this case anyway
    const startRects = new Map<string, Rect>();
    for (const o of selected) startRects.set(o.id, objectBounds(o));
    const startBox = unionRects([...startRects.values()]);
    if (!startBox) return;
    pressRef.current = {
      kind: 'handle',
      pointerId: e.pointerId,
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      phase: 'pressed',
      startBox,
      startRects,
      minSizes,
      aspectLocked,
    };
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
