// The one gesture that transforms objects (`sel.transform`).
//
// Story 2 kept a drag loop inside StickyNote. This replaced it: one gesture for every
// object type, which either moves the whole selection or resizes the box around it.
// A type that wants either of those registers in the object registry
// (sel.all_types); it does not get to write pointer handling of its own.
//
// Two rules that look small and are not:
//
//   - A gesture writes *absolute* positions worked out from where each object was
//     when the gesture became a gesture, never from where it is now. The document is
//     shared: a remote change arriving mid-drag must not push this screen's objects
//     out from under the pointer, and must not be folded into the next delta.
//   - Each pointermove only records a delta; the document is written at most once per
//     animation frame, in one transaction, so other people see the group travel
//     together instead of lagging behind this screen's frame rate.
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  objectMinSize,
  resizeObjects,
  selectionBounds,
} from '../../shared/board-model';
import type { Handle, Point, Rect } from '../../shared/geometry';
import {
  askedResizeScale,
  clampScale,
  scaleRectByFactor,
  scaleWithin,
} from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: UseSelectionResult;
  /** Every object in the document, of every kind, as the model read it. */
  snapshot: readonly BoardObject[];
  /** False when the board could not be loaded: the gesture is refused outright. */
  canEdit: boolean;
  /** Called exactly once per gesture, when a press becomes a move or a resize. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureHandlers {
  onObjectPointerDown(event: PointerEvent, id: string): void;
  onHandlePointerDown(event: PointerEvent, handle: Handle): void;
}

type Phase = 'idle' | 'pending' | 'move' | 'resize';

/**
 * Everything the gesture remembers. One object, not a union: the handlers live as
 * long as the board does and read this through a ref, so a gesture started in an old
 * render still ends properly.
 */
interface GestureState {
  phase: Phase;
  pointerId: number;
  /** Where the pointer was when the press began, in screen pixels. */
  startX: number;
  startY: number;
  /** The newest unapplied delta, in screen pixels. */
  dx: number;
  dy: number;
  shift: boolean;
  /** Where each object in the selection was when the gesture started. */
  start: Map<string, Rect>;
  /** The selection's box at gesture start: the frame a resize scales everything against. */
  startBox: Rect | null;
  handle: Handle;
  /** True when any selected type keeps its proportions. */
  aspectLocked: boolean;
  frame: number | null;
}

/** Rectangles of the selected objects that are actually there, by id. */
function startRects(objects: readonly BoardObject[], ids: ReadonlySet<string>): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const object of objects) {
    if (ids.has(object.id)) out.set(object.id, objectBounds(object));
  }
  return out;
}

/** Does any object of this selection answer true? (Registry lookups live here.) */
function anySelected(
  ids: ReadonlySet<string>,
  snapshot: readonly BoardObject[],
  predicate: (type: string) => boolean,
): boolean {
  for (const object of snapshot) {
    if (!ids.has(object.id)) continue;
    if (predicate(object.type)) return true;
  }
  return false;
}

export function useTransformGesture(options: TransformGestureOptions): TransformGestureHandlers {
  // Inputs are read through a ref: the pointer listeners are installed once and must
  // never work from a stale render's document, camera or selection.
  const live = useRef(options);
  live.current = options;

  const state = useRef<GestureState>({
    phase: 'idle',
    pointerId: 0,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    shift: false,
    start: new Map<string, Rect>(),
    startBox: null,
    handle: 'se',
    aspectLocked: false,
    frame: null,
  });

  // The move / release handlers, refreshed every render and called through this ref
  // by the window listeners installed once at mount.
  const handlers = useRef<{ move(event: PointerEvent): void; release(): void } | null>(null);

  /** The smallest this object's type allows, 0 for a type not known here. */
  const minSizeOf = (id: string): number => {
    const object = live.current.snapshot.find((candidate) => candidate.id === id);
    return object ? objectMinSize(object.type) : 0;
  };

  /** Write the selection at its start plus the newest delta. Idempotent. */
  const apply = (): void => {
    const g = state.current;
    if (g.phase !== 'move' && g.phase !== 'resize') return;
    const { doc, canEdit, camera } = live.current;
    // A board that could not be loaded is not edited by a drag (TC-25).
    if (!canEdit) return;

    const zoom = camera.zoom || 1;
    const world: Point = { x: g.dx / zoom, y: g.dy / zoom };

    if (g.phase === 'move') {
      // Absolute positions, worked out from the start rectangles: whatever else the
      // document went through meanwhile, the selection ends where this pointer says.
      // Objects that are gone in the meantime are skipped (TC-05).
      const positions = new Map<string, Point>();
      for (const [id, rect] of g.start) {
        positions.set(id, { x: rect.x + world.x, y: rect.y + world.y });
      }
      moveObjects(doc, positions);
      return;
    }

    const box = g.startBox;
    if (!box) return;
    // Resize: the scale the pointer asked for, then the largest scale every object
    // can actually take (sel.size_limits), so the group stops the moment the first
    // object reaches its limit and the layout inside the selection stays as it was.
    const asked = askedResizeScale(box, g.handle, world, g.aspectLocked || g.shift);
    const rects: Rect[] = [];
    const minSizes: number[] = [];
    for (const [id, rect] of g.start) {
      rects.push(rect);
      minSizes.push(minSizeOf(id));
    }
    const scale = clampScale(asked, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
    const to = scaleRectByFactor(box, g.handle, scale);
    const next = new Map<string, Rect>();
    for (const [id, rect] of g.start) next.set(id, scaleWithin(rect, box, to));
    resizeObjects(doc, next);
  };

  /** Schedule the write for the next animation frame, at most one per frame. */
  const schedule = (): void => {
    const g = state.current;
    if (g.frame !== null) return;
    g.frame = requestAnimationFrame(() => {
      g.frame = null;
      apply();
    });
  };

  /** A press on an object that has moved far enough: it moves the whole selection. */
  const beginMove = (): void => {
    const g = state.current;
    const { doc, selection, snapshot, onGestureStart } = live.current;
    const start = startRects(snapshot, selection.ids);
    if (start.size === 0) {
      g.phase = 'idle';
      return;
    }
    // The selection goes above everything it is not part of, keeping its own
    // internal stacking (sel.group_move, TC-06).
    bringObjectsToFront(doc, [...start.keys()]);
    g.phase = 'move';
    g.start = start;
    g.startBox = null;
    onGestureStart?.();
    // The move that crossed the threshold is applied at once, not a frame later.
    apply();
  };

  /** Release, however it came about: keep what was applied, and say so once. */
  const release = (): void => {
    const g = state.current;
    if (g.phase === 'idle') return;
    if (g.phase === 'pending') {
      // A press that never moved far enough: it was a click, and the note already
      // holds the selection from the press.
      g.phase = 'idle';
      return;
    }
    if (g.frame !== null) {
      cancelAnimationFrame(g.frame);
      g.frame = null;
    }
    // The last delta is applied synchronously so the objects stop under the pointer
    // rather than one frame behind it.
    apply();
    g.phase = 'idle';
    g.start.clear();
    g.startBox = null;
    live.current.onGestureEnd?.();
  };

  const move = (event: PointerEvent): void => {
    const g = state.current;
    if (g.phase === 'idle') return;
    if (event.pointerId !== g.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    g.shift = event.shiftKey;

    if (g.phase === 'pending') {
      // Story 2's rule, unchanged: 3 screen pixels, whatever the zoom (TC-19, TC-20).
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.dx = dx;
      g.dy = dy;
      beginMove();
      return;
    }
    g.dx = dx;
    g.dy = dy;
    schedule();
  };

  handlers.current = {
    move,
    release,
  };

  // Installed once, for as long as the board is on screen: a gesture started in an
  // earlier render still ends, and a pointerup that lands outside the window or a
  // pointercancel still releases everything (the last applied write is kept).
  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => handlers.current?.move(event);
    const onRelease = (): void => handlers.current?.release();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onRelease);
    window.addEventListener('pointercancel', onRelease);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
      const g = state.current;
      if (g.frame !== null) cancelAnimationFrame(g.frame);
      g.frame = null;
      g.phase = 'idle';
    };
  }, []);

  const onObjectPointerDown = (event: PointerEvent, id: string): void => {
    const g = state.current;
    const { doc, canEdit, selection, snapshot } = live.current;
    if (!canEdit) return;

    const wasSelected = selection.ids.has(id);
    if (event.shiftKey) {
      // Shift is the selection key: it adds this object to the selection, or takes it
      // back out when it is already in it (TC-13, TC-14). It never starts a move of a
      // selection the object is not part of.
      selection.toggle(id);
    } else if (!wasSelected) {
      // Pressing something outside the selection makes it the whole selection, and the
      // gesture that follows moves only that one (TC-23).
      selection.click(id);
    }

    // A press raises the object it landed on — the way story 2 raised a note, which
    // is what makes a double-clicked note come forward without moving it. A press
    // inside a multi-selection raises the whole group instead, when the press becomes
    // a move; a shift-press only ever edits the selection, so it raises nothing.
    const lone = wasSelected ? selection.ids.size === 1 : true;
    if (lone && !event.shiftKey && snapshot.some((object) => object.id === id)) {
      bringObjectsToFront(doc, [id]);
    }

    g.phase = 'pending';
    g.pointerId = event.pointerId;
    g.startX = event.clientX;
    g.startY = event.clientY;
    g.dx = 0;
    g.dy = 0;
    g.shift = event.shiftKey;
    g.start.clear();
    g.startBox = null;
  };

  const onHandlePointerDown = (event: PointerEvent, handle: Handle): void => {
    const g = state.current;
    const { canEdit, selection, snapshot, onGestureStart } = live.current;
    if (!canEdit) return;
    const ids = selection.ids;
    // No selected type can be resized: the handles are hidden and this is ignored.
    if (!anySelected(ids, snapshot, (type) => getObjectType(type)?.resizable ?? false)) return;

    const start = startRects(snapshot, ids);
    const box = selectionBounds(snapshot, [...ids]);
    if (!box || start.size === 0) return;

    g.phase = 'resize';
    g.handle = handle;
    g.pointerId = event.pointerId;
    g.startX = event.clientX;
    g.startY = event.clientY;
    g.dx = 0;
    g.dy = 0;
    g.shift = event.shiftKey;
    g.start = start;
    g.startBox = box;
    g.aspectLocked = anySelected(ids, snapshot, (type) => getObjectType(type)?.aspectLocked ?? false);
    onGestureStart?.();
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
