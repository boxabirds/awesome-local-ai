import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';

import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
  type Point,
  type Rect,
} from '../../shared/board-model.js';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config.js';
import {
  clampScale,
  resizeRect,
  scaleRectFrom,
  scaleWithin,
  unionRects,
  type Handle,
} from '../../shared/geometry.js';
import type { Camera } from '../canvas/camera.js';
import { getObjectType, type ObjectTypeSpec } from '../objects/registry.js';
import type { UseSelectionResult } from './useSelection.js';

/**
 * The one gesture that moves and resizes the selection
 * (`src/client/board/useTransformGesture.ts`).
 *
 * This is the whole "drag the box / drag a handle / drag the background with
 * Shift held down" interaction, and it deliberately lives here rather than in the
 * object components (Key decision 4): moving the *selection* is one interaction
 * over *many* objects, so the component that starts it - a sticky note, or a
 * resize handle in the overlay - delegates the pointer to these two callbacks and
 * keeps no drag state of its own. Because it lives here, moving a group needs no
 * per-type code: it reads each object's bounds, moves or resizes them together,
 * and writes the whole group in one transaction per animation frame.
 *
 * Rules this holds (PRD):
 * - a press that stays under `DRAG_THRESHOLD_PX` selects without moving;
 * - the first movement past that threshold raises the selection above everything
 *   unselected and starts one gesture (`onGestureStart` fires exactly once);
 * - writes are coalesced to one `doc.transact` per animation frame (`sel.raf`);
 * - releasing or cancelling keeps the last applied position (nothing rolls back);
 * - Shift-click toggles an object in or out of the selection and does not drag.
 */

export interface TransformGesture {
  /** Start a move (or a toggle, with Shift) of one object from a pointerdown. */
  onObjectPointerDown(event: ReactPointerEvent, id: string): void;
  /** Start a resize of the whole selection from a pointerdown on a handle. */
  onHandlePointerDown(event: ReactPointerEvent, handle: Handle): void;
  /** The ids currently being dragged - the renderer shows them as `dragging`. */
  draggingIds: ReadonlySet<string>;
}

const NO_DRAG: ReadonlySet<string> = new Set<string>();
const THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

/** A gesture in flight. `started` flips once the pointer passes the threshold. */
interface Active {
  pointerId: number;
  mode: 'move' | 'resize';
  handle: Handle;
  aspectLocked: boolean;
  fromX: number;
  fromY: number;
  /** The ids this gesture will write when it moves. */
  ids: string[];
  /** Each id's rectangle at gesture start; every later write is derived from these. */
  startRects: Map<string, Rect>;
  /** The union of those rectangles - what a handle actually drags. */
  startBox: Rect;
  startBoxArea: number;
  /** The rectangles and per-object minimum sizes for the group clamp. */
  rects: Rect[];
  minSizes: number[];
  /**
   * The objects of this gesture that do not take a rectangle as drawn, by id
   * (story 9: a text object's height is a measurement, not something a pointer
   * can drag). Everything else is written by `resizeObjects` as one group.
   */
  resizeTo: Map<string, NonNullable<ObjectTypeSpec['resizeTo']>>;
  started: boolean;
  /** The exact window listeners, so the gesture can detach itself on unmount. */
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Called once when a drag crosses the threshold (story 8's undo coalescer). */
  onGestureStart?(): void;
  /** Called once when a started drag ends or is cancelled. */
  onGestureEnd?(): void;
}

export function useTransformGesture({
  doc,
  camera,
  selection,
  snapshot,
  canEdit,
  onGestureStart,
  onGestureEnd,
}: TransformGestureOptions): TransformGesture {
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(NO_DRAG);

  // Latest values for the window-level listeners, which outlive a single render.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const startCb = useRef(onGestureStart);
  startCb.current = onGestureStart;
  const endCb = useRef(onGestureEnd);
  endCb.current = onGestureEnd;

  const active = useRef<Active | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);

  /**
   * Drop the in-flight gesture's window listeners and pending frame. Used on
   * release, on cancel, and on unmount: without the unmount path a drag left
   * active when the board tears down would keep its listeners on the shared
   * window and fire into whichever test or view runs next.
   */
  const detach = useCallback((g: Active) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
    window.removeEventListener('pointermove', g.onMove);
    window.removeEventListener('pointerup', g.onUp);
    window.removeEventListener('pointercancel', g.onUp);
    window.removeEventListener('lostpointercapture', g.onUp);
  }, []);

  /** Write the group at the latest pointer position (one transaction). */
  const apply = useCallback(
    (g: Active, x: number, y: number) => {
      const zoom = cameraRef.current.zoom || 1;
      const dx = (x - g.fromX) / zoom;
      const dy = (y - g.fromY) / zoom;
      if (g.mode === 'move') {
        const positions = new Map<string, Point>();
        for (const id of g.ids) {
          const rect = g.startRects.get(id);
          if (rect) positions.set(id, { x: rect.x + dx, y: rect.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }
      // Resize: the dragged rectangle drives a per-axis scale that the *whole*
      // group shares, then each object is laid out inside the scaled box.
      const dragged = resizeRect(g.startBox, g.handle, { x: dx, y: dy }, g.aspectLocked);
      const requested = {
        x: g.startBox.width > 0 ? dragged.width / g.startBox.width : 1,
        y: g.startBox.height > 0 ? dragged.height / g.startBox.height : 1,
      };
      const scale = clampScale(requested, g.rects, g.minSizes, MAX_OBJECT_SIZE_WORLD);
      const target = scaleRectFrom(g.startBox, g.handle, scale);
      const rects = new Map<string, Rect>();
      // One object being resized on its own is the only case in which a handle
      // means "this wide"; scaled with others, it means "this much wider".
      const sole = g.ids.length === 1;
      for (const id of g.ids) {
        const rect = g.startRects.get(id);
        if (!rect) continue;
        const laid = scaleWithin(rect, g.startBox, target);
        const own = g.resizeTo.get(id);
        if (own) {
          // Its own type decides what to keep of that rectangle. A text object
          // takes the width and measures the height, so a group resize still moves
          // it into place without touching how big its letters are.
          own(doc, id, laid, sole);
          continue;
        }
        rects.set(id, laid);
      }
      if (rects.size > 0) resizeObjects(doc, rects);
    },
    [doc],
  );

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const g = active.current;
      if (!g || event.pointerId !== g.pointerId) return;
      const dx = event.clientX - g.fromX;
      const dy = event.clientY - g.fromY;
      if (!g.started) {
        if (dx * dx + dy * dy < THRESHOLD_SQ) return;
        // The gesture is real now: fire the undo bracket, and raise a moved
        // selection above everything it is not sharing with unselected objects.
        g.started = true;
        startCb.current?.();
        if (g.mode === 'move') bringObjectsToFront(doc, g.ids);
        setDraggingIds(new Set(g.ids));
      }
      pending.current = { x: event.clientX, y: event.clientY };
      if (frame.current === null) {
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const p = pending.current;
          if (p) apply(g, p.x, p.y);
        });
      }
    },
    [apply, doc],
  );

  const handleUp = useCallback(
    (event: PointerEvent) => {
      const g = active.current;
      if (!g || event.pointerId !== g.pointerId) return;
      // Land the last position synchronously before ending, so a fast flick whose
      // final frame never got to run is still applied.
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      const last = pending.current;
      pending.current = null;
      if (last) apply(g, last.x, last.y);
      active.current = null;
      detach(g);
      if (g.started) {
        setDraggingIds(NO_DRAG);
        endCb.current?.();
      }
    },
    [apply, handleMove, detach],
  );

  /** Capture the group's rectangles at gesture start and begin listening. */
  const begin = useCallback(
    (
      event: ReactPointerEvent,
      mode: 'move' | 'resize',
      handle: Handle,
      ids: string[],
      aspectLocked: boolean,
    ) => {
      const byId = new Map(snapshot.map((object) => [object.id, object]));
      const startRects = new Map<string, Rect>();
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      const resizeTo = new Map<string, NonNullable<ObjectTypeSpec['resizeTo']>>();
      for (const id of ids) {
        const object = byId.get(id);
        if (!object) continue;
        const rect = objectBounds(object);
        startRects.set(id, rect);
        rects.push(rect);
        const spec = getObjectType(object.type);
        minSizes.push(spec?.minSize ?? 0);
        if (spec?.resizeTo) resizeTo.set(id, spec.resizeTo);
      }
      const startBox = unionRects(rects);
      if (!startBox) return;
      // A gesture should never overlap another; drop a stale one defensively.
      if (active.current) detach(active.current);
      active.current = {
        pointerId: event.pointerId,
        mode,
        handle,
        aspectLocked,
        fromX: event.clientX,
        fromY: event.clientY,
        ids: [...startRects.keys()],
        startRects,
        startBox,
        startBoxArea: startBox.width * startBox.height,
        rects,
        minSizes,
        resizeTo,
        started: false,
        onMove: handleMove,
        onUp: handleUp,
      };
      // Capture so a drag that leaves the object still tracks this pointer.
      (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      window.addEventListener('lostpointercapture', handleUp);
    },
    [snapshot, handleMove, handleUp, detach],
  );

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent, id: string) => {
      if (event.button !== 0) return;
      // The object swallows the press so the board does not pan under it.
      event.stopPropagation();
      const sel = selection;
      if (sel.editingId === id) return; // this note is being typed into
      if (event.shiftKey) {
        sel.toggle(id);
        return;
      }
      const alreadySelected = sel.ids.has(id);
      if (!alreadySelected) sel.click(id);
      if (!canEditRef.current) return; // selecting a note on a read-only board is fine
      const ids = alreadySelected ? [...sel.ids] : [id];
      begin(event, 'move', 'se', ids, false);
    },
    [selection, begin],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent, handle: Handle) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      if (!canEditRef.current) return;
      const sel = selection;
      const ids = [...sel.ids];
      if (ids.length === 0) return;
      const byId = new Map(snapshot.map((object) => [object.id, object]));
      let aspectLocked = event.shiftKey;
      let anyResizable = false;
      for (const id of ids) {
        const spec = byId.has(id) ? getObjectType(byId.get(id)!.type) : undefined;
        if (!spec) continue;
        if (spec.resizable) anyResizable = true;
        if (spec.aspectLocked) aspectLocked = true;
      }
      // No selected type can be resized - the handles are not even drawn, but a
      // stray call must not resize either.
      if (!anyResizable) return;
      begin(event, 'resize', handle, ids, aspectLocked);
    },
    [selection, snapshot, begin],
  );

  // If the board unmounts mid-drag, drop the listeners so they cannot leak onto
  // the shared window and fire later. active.current is a ref, so this runs once.
  useEffect(() => () => {
    const g = active.current;
    if (g) {
      active.current = null;
      detach(g);
    }
  }, [detach]);

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}
