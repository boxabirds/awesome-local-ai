// Group move and group resize (design `sel.transform`).
//
// One gesture, many objects: a pointer press on an object selects it (or keeps the
// selection if it was already part of it) and a drag past DRAG_THRESHOLD_PX moves
// every selected object by the same world delta; a press on a selection handle
// scales them together around the handle that was dragged.
//
// ## The write pattern, and why it is safe
//
// Writes are throttled to one per animation frame, and *every* write is the
// absolute world position implied by the pointer — never a delta on top of the
// last write. So a frame that is skipped loses nothing: the next write lands the
// pointer exactly where it is. On pointerup, pointercancel or lostpointercapture
// the pending position is applied one final time, so a cancelled gesture keeps the
// last positions the pointer actually reached rather than snapping back.
//
// Because a remote change can arrive mid-gesture (a colleague deleted the object
// you are dragging), every write is built from the ids still present in the latest
// snapshot: vanished objects are skipped, and when nothing of the selection is left
// the gesture stops instead of writing.
//
// `onGestureStart` fires only once the threshold is crossed — never on a click — and
// `onGestureEnd` fires exactly once, so story 8's "my selection is in use" hint can
// rely on the pair matching. It does not mutate the doc, and this module does not
// import story 8.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  bringObjectsToFront,
  deleteObjects,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model.ts';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../shared/config.ts';
import {
  clampScale,
  handleNorth,
  handleWest,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry.ts';
import type { Camera } from '../canvas/camera.ts';
import { getObjectType } from '../objects/registry.tsx';
import type { Selection } from './useSelection.ts';
import { setTextWidthFixed, setTextBox } from '../../shared/objects/text.ts';
import { layoutText } from '../objects/textLayout.ts';
import { textSnapshot } from '../../shared/objects/text.ts';
import { textMeasure } from '../objects/measurer.ts';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** A group transform actually began (past the drag threshold). */
  onGestureStart?(): void;
  /** It finished, was cancelled or could not continue. Fires exactly once. */
  onGestureEnd?(): void;
  /**
   * Story 8: close the undo capture window. Called once when a gesture starts and
   * once when it ends, so the dozens of per-frame writes in between stay one undo
   * step (design Key decision 2) and a drag never merges with the click before or
   * after it. Absent for a caller that is not undoing anything.
   */
  boundary?(): void;
}

export interface TransformGestureHandlers {
  /** A board object received a pointer press. */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** A selection overlay resize handle received a pointer press. */
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, h: Handle): void;
}

/** One selected object, as it was when the gesture started. */
interface Entry {
  id: string;
  rect: Rect;
  /** The smallest side its type allows. */
  min: number;
  /** Whether its type refuses to change shape. */
  aspectLocked: boolean;
  /** Story 9: a type whose height follows its content (text) resizes width only. */
  horizontal: boolean;
}

type Write =
  | { kind: 'move'; positions: Map<string, Point> }
  | { kind: 'resize'; rects: Map<string, Rect> }
  /** Story 9: a single horizontal (text) object dragged wider/narrower. */
  | { kind: 'textwidth'; id: string; width: number };

/** The four ways a pointer can leave a gesture. */
const END_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'] as const;

/** Delete the selection; returns false when the board cannot be edited. */
export function deleteSelection(
  doc: Y.Doc,
  selection: Selection,
  canEdit: boolean,
): boolean {
  if (!canEdit || selection.ids.size === 0) return false;
  const ids = [...selection.ids];
  deleteObjects(doc, ids);
  selection.clear();
  return true;
}

export function useTransformGesture(opts: TransformGestureOptions): TransformGestureHandlers {
  // Everything a window listener can see is kept in a ref: the listeners are
  // attached when the gesture starts and must never use a stale camera, snapshot
  // or edit lock.
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const cameraRef = useRef(opts.camera);
  cameraRef.current = opts.camera;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onStartRef = useRef(opts.onGestureStart);
  onStartRef.current = opts.onGestureStart;
  const onEndRef = useRef(opts.onGestureEnd);
  onEndRef.current = opts.onGestureEnd;
  const boundaryRef = useRef(opts.boundary);
  boundaryRef.current = opts.boundary;

  const phaseRef = useRef<'idle' | 'pressed' | 'moving' | 'resizing'>('idle');
  const startedRef = useRef(false); // onGestureStart fired, onGestureEnd owed
  const entriesRef = useRef<Entry[]>([]);
  const startClientRef = useRef<Point>({ x: 0, y: 0 });
  const startBoxRef = useRef<Rect | null>(null);
  const handleRef = useRef<Handle>('se');
  const aspectRef = useRef(false);
  const pendingRef = useRef<Write | null>(null);
  const rafRef = useRef<number | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      // Unmounted mid-gesture (a route change): drop the pending write, never the
      // document.
      mountedRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingRef.current = null;
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  /** The selected objects as they are right now, in selection order. */
  const entriesOf = (ids: Iterable<string>): Entry[] => {
    const out: Entry[] = [];
    for (const id of ids) {
      const obj = snapshotRef.current.find((o) => o.id === id);
      if (!obj) continue; // pruned mid-gesture: skipped
      const spec = getObjectType(obj.type);
      out.push({
        id,
        rect: objectBounds(obj),
        min: spec?.minSize ?? STICKY_MIN_SIZE_WORLD,
        aspectLocked: spec?.aspectLocked ?? false,
        horizontal: (spec?.handles ?? 'all') === 'horizontal',
      });
    }
    return out;
  };

  /** One animation frame's write. Returns how many objects it touched. */
  const write = (pending: Write): number => {
    if (!mountedRef.current || !canEditRef.current) return 0;
    const doc = docRef.current;
    if (pending.kind === 'move') {
      // Only ids still in the latest snapshot: a note deleted by a colleague a
      // frame ago must not be resurrected.
      const present = new Set(snapshotRef.current.map((o) => o.id));
      const positions = new Map<string, Point>();
      for (const [id, p] of pending.positions) if (present.has(id)) positions.set(id, p);
      return moveObjects(doc, positions);
    }
    if (pending.kind === 'textwidth') {
      // The width is fixed by the drag; the height rewraps to the content. Both land
      // as one undo step (the gesture owns the boundary).
      setTextWidthFixed(doc, pending.id, pending.width);
      const snap = textSnapshot(doc, pending.id);
      if (snap) {
        const box = layoutText(snap.text, snap.size, 'fixed', pending.width, textMeasure);
        setTextBox(doc, pending.id, { width: box.width, height: box.height });
      }
      return 1;
    }
    return resizeObjects(doc, pending.rects);
  };

  const notifyEnd = () => {
    if (!startedRef.current) return;
    startedRef.current = false;
    onEndRef.current?.();
  };

  /** End the gesture: cancel the loop, apply the last write exactly once. */
  const finish = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    phaseRef.current = 'idle';
    entriesRef.current = [];
    startBoxRef.current = null;
    if (pending) write(pending);
    detachRef.current?.();
    detachRef.current = null;
    // The step this gesture wrote is finished — including the last frame, which is
    // applied just above. Whatever comes next is a different action.
    boundaryRef.current?.();
    notifyEnd();
  };

  /** Stop without applying anything more (the selection is gone). */
  const abandon = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    phaseRef.current = 'idle';
    entriesRef.current = [];
    startBoxRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    // A gesture that stopped early still wrote frames: close that step too.
    boundaryRef.current?.();
    notifyEnd();
  };

  const schedule = (write_: Write) => {
    pendingRef.current = write_;
    if (rafRef.current !== null) return; // one frame already in flight
    rafRef.current = requestAnimationFrame(function frame() {
      rafRef.current = null;
      const pending = pendingRef.current;
      if (!pending) return; // finished or cancelled this frame
      pendingRef.current = null;
      const applied = write(pending);
      if (applied === 0) {
        abandon(); // nothing of the selection is left to transform
        return;
      }
      // A press-and-hold keeps the object welded to the pointer even if the
      // pointer sits still: pending is null, so the next frame writes nothing new
      // and the loop stops on its own.
    });
  };

  /** The move handler for both gestures. */
  const onWindowMove = (e: PointerEvent | MouseEvent) => {
    const phase = phaseRef.current;
    if (phase === 'idle') return;
    const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
    const world: Point = {
      x: (e.clientX - startClientRef.current.x) / zoom,
      y: (e.clientY - startClientRef.current.y) / zoom,
    };

    if (phase === 'pressed') {
      // A press is not a gesture until the pointer has clearly moved; otherwise a
      // plain click would move objects and announce a gesture.
      const screen = {
        x: e.clientX - startClientRef.current.x,
        y: e.clientY - startClientRef.current.y,
      };
      if (Math.hypot(screen.x, screen.y) < DRAG_THRESHOLD_PX) return;
      const entries = entriesOf(selectionRef.current.ids);
      if (entries.length === 0) {
        detach();
        phaseRef.current = 'idle';
        return; // the selection vanished before the drag began
      }
      entriesRef.current = entries;
      phaseRef.current = 'moving';
      startedRef.current = true;
      // Story 8's boundary: a plain click never gets here, so a click that selects
      // does not open a step. Everything from here — the raise below included — is
      // one action.
      boundaryRef.current?.();
      onStartRef.current?.();
      // The selection moves above anything it does not contain (TC-09).
      bringObjectsToFront(docRef.current, entries.map((entry) => entry.id));
    }

    if (!canEditRef.current) return; // the board locked while the pointer was down
    const entries = entriesRef.current;
    if (entries.length === 0) return;

    if (phaseRef.current === 'moving') {
      const positions = new Map<string, Point>();
      for (const entry of entries) {
        positions.set(entry.id, { x: entry.rect.x + world.x, y: entry.rect.y + world.y });
      }
      schedule({ kind: 'move', positions });
      return;
    }

    if (phaseRef.current === 'resizing') {
      const start = startBoxRef.current;
      if (!start || start.width <= 0 || start.height <= 0) return;
      // A single horizontal-only object (story 9's text): the drag sets its width and
      // the height rewraps to the content; only the e/w handles are ever offered for
      // it. The min side clamps the width; MAX_OBJECT_SIZE_WORLD clamps the max.
      if (entries.length === 1 && entries[0]!.horizontal) {
        const entry = entries[0]!;
        const dx = handleWest(handleRef.current) ? -world.x : world.x;
        let width = start.width + dx;
        width = Math.min(Math.max(width, entry.min), MAX_OBJECT_SIZE_WORLD);
        schedule({ kind: 'textwidth', id: entry.id, width });
        return;
      }
      // A type that locks its shape does; a type that does not is free. Holding
      // Shift asks an aspect-free type to keep the ratio anyway.
      const aspect = aspectRef.current || e.shiftKey;
      const requested = resizeRect(start, handleRef.current, world, aspect);
      const scale = clampScale(
        { x: requested.width / start.width, y: requested.height / start.height },
        entries.map((entry) => entry.rect),
        entries.map((entry) => entry.min),
        MAX_OBJECT_SIZE_WORLD,
      );
      const to: Rect = {
        width: start.width * scale.x,
        height: start.height * scale.y,
        x: handleWest(handleRef.current)
          ? start.x + start.width - start.width * scale.x
          : start.x,
        y: handleNorth(handleRef.current)
          ? start.y + start.height - start.height * scale.y
          : start.y,
      };
      const rects = new Map<string, Rect>();
      for (const entry of entries) {
        rects.set(entry.id, scaleWithin(entry.rect, start, to));
      }
      schedule({ kind: 'resize', rects });
    }
  };

  const detach = () => {
    detachRef.current?.();
    detachRef.current = null;
  };

  const attach = () => {
    detach();
    const move = (e: Event) => onWindowMove(e as MouseEvent);
    const end = () => finish();
    window.addEventListener('pointermove', move);
    for (const name of END_EVENTS) {
      window.addEventListener(name, end as EventListener);
    }
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      for (const name of END_EVENTS) {
        window.removeEventListener(name, end as EventListener);
      }
    };
  };

  const beginPress = (e: ReactPointerEvent<HTMLElement>) => {
    startClientRef.current = { x: e.clientX, y: e.clientY };
    phaseRef.current = 'pressed';
    attach();
  };

  const onObjectPointerDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return; // right- and middle-click never select or drag
    // A note press must never pan the board.
    e.stopPropagation();
    const selection = selectionRef.current;
    if (e.shiftKey) {
      selection.toggle(id); // add/remove from the selection: never a drag
      return;
    }
    // Dragging an object that is not selected selects it alone.
    if (!selection.ids.has(id)) selection.click(id);
    if (!canEditRef.current) return; // read-only: selecting is fine, moving is not
    entriesRef.current = entriesOf(selection.ids);
    beginPress(e);
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLElement>, h: Handle) => {
    if (e.button !== 0 || !canEditRef.current) return;
    e.stopPropagation();
    const entries = entriesOf(selectionRef.current.ids);
    if (entries.length === 0) return;
    const box = unionRects(entries.map((entry) => entry.rect));
    if (!box) return;
    entriesRef.current = entries;
    startBoxRef.current = box;
    handleRef.current = h;
    // The shape a type keeps is a property of the type, not of this drag.
    aspectRef.current = entries.some((entry) => entry.aspectLocked);
    startClientRef.current = { x: e.clientX, y: e.clientY };
    phaseRef.current = 'resizing';
    startedRef.current = true;
    boundaryRef.current?.(); // a resize is its own step as well
    onStartRef.current?.();
    attach();
  };

  return { onObjectPointerDown, onHandlePointerDown };
}
