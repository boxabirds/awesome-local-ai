import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  clampScale,
  resizeRect,
  scaleRectAbout,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { screenDeltaToWorld, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/** What the pointer is doing right now. */
export type TransformMode = 'idle' | 'pressed' | 'moving' | 'resizing';

export interface TransformGestures {
  readonly mode: TransformMode;
  /** The box being resized, in board units, while `mode === 'resizing'`. */
  readonly box: Rect | null;
  /** A type's component calls this from its root element's `onPointerDown`. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** `SelectionOverlay` calls this from a resize handle's `onPointerDown`. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

export interface TransformOptions {
  doc: Y.Doc;
  editable: boolean;
  camera: Camera;
  /** Every object on the board right now. */
  objects: readonly ObjectSnapshot[];
  selectedIds: ReadonlySet<string>;
  /** A press released without moving. */
  click(id: string): void;
  /** The same press released with shift held. */
  toggle(id: string): void;
  /** Story 8 reads `mode` to pause presence broadcasting during a gesture. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface Active {
  mode: TransformMode;
  /** The object the press landed on (undefined for a handle). */
  id: string | null;
  handle: Handle;
  /** The objects this gesture writes, fixed when the press happens. */
  ids: string[];
  /** Where each of them was then. */
  base: Map<string, Rect>;
  /** The selection's bounding box then. */
  baseBox: Rect | null;
  /** Whether to hold the proportions: the type says, shift inverts. */
  aspectLocked: boolean;
  minSizes: number[];
  start: Point;
  /** The last box computed, so the overlay can draw it. */
  box: Rect | null;
  /** The press that became a click was a shift-click. */
  toggleSelection: boolean;
  /** The press landed on an object outside the selection, which it joins alone. */
  selectOnDrag: boolean;
}

/** Whole board units: the document keeps whole numbers, see `moveObjects`. */
function round(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * One gesture, whatever it turns out to be.
 *
 * A press on an object is undecided until the pointer moves `DRAG_THRESHOLD_PX`:
 * under it, releasing is a click; over it, the whole selection moves together. A
 * press on a handle resizes. The objects and their boxes are read once, when the
 * press happens, and every frame is computed from that frozen base and the total
 * pointer delta, writing absolute board positions (design key decision 1) — so
 * two people dragging the same object converge on the last writer instead of
 * drifting apart, and a mid-drag delete simply stops writing that object.
 *
 * The listeners are on `window`, not on the element: a gesture must keep running
 * when the pointer leaves the object, and must not depend on pointer capture,
 * which is why a story 2 drag used `setPointerCapture` and this one does not.
 */
export function useTransformGesture(options: TransformOptions): TransformGestures {
  const [mode, setMode] = useState<TransformMode>('idle');
  const [box, setBox] = useState<Rect | null>(null);

  // The options change every render (new snapshot, new camera); the gesture reads
  // them through a ref so a move handler attached at pointerdown never goes stale.
  const opts = useRef(options);
  opts.current = options;
  const active = useRef<Active | null>(null);

  const finish = useCallback((clicked: boolean) => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    setMode('idle');
    setBox(null);
    if (current.mode === 'pressed') {
      if (clicked && current.id !== null) {
        if (current.toggleSelection) opts.current.toggle(current.id);
        else opts.current.click(current.id);
      }
    } else {
      opts.current.onGestureEnd?.();
    }
  }, []);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const current = active.current;
    if (!current) return;
    const delta = { x: event.clientX - current.start.x, y: event.clientY - current.start.y };

    if (current.mode === 'pressed') {
      if (Math.hypot(delta.x, delta.y) < DRAG_THRESHOLD_PX) return;
      current.mode = 'moving';
      setMode('moving');
      // A press on an object outside the selection becomes that object's drag, and
      // the selection follows it at once: the toolbar, the keyboard and the next
      // gesture all find the thing you have just grabbed.
      if (current.selectOnDrag && current.id !== null) {
        if (current.toggleSelection) opts.current.toggle(current.id);
        else opts.current.click(current.id);
      }
      // Close the undo capture window first, so the raise below and the moves
      // that follow are one step that is not merged with the previous action.
      opts.current.onGestureStart?.();
      // Raise the whole group above everything else, once, at the start (TC-30).
      bringObjectsToFront(opts.current.doc, current.ids);
    }

    if (current.mode === 'moving') {
      const world = screenDeltaToWorld(opts.current.camera, delta);
      const positions = new Map<string, Point>();
      for (const id of current.ids) {
        const from = current.base.get(id);
        if (from) positions.set(id, { x: Math.round(from.x + world.x), y: Math.round(from.y + world.y) });
      }
      // Zero written means every object in the group is gone: stop the gesture.
      if (moveObjects(opts.current.doc, positions) === 0) finish(false);
      return;
    }

    if (current.mode === 'resizing' && current.baseBox) {
      const world = screenDeltaToWorld(opts.current.camera, delta);
      const dragged = resizeRect(current.baseBox, current.handle, world, current.aspectLocked);
      const requested = {
        x: dragged.width / current.baseBox.width,
        y: dragged.height / current.baseBox.height,
      };
      const scale = clampScale(requested, [...current.base.values()], current.minSizes, MAX_OBJECT_SIZE_WORLD);
      const to = scaleRectAbout(current.baseBox, current.handle, scale);
      const rects = new Map<string, Rect>();
      for (const id of current.ids) {
        const from = current.base.get(id);
        if (from) rects.set(id, round(scaleWithin(from, current.baseBox, to)));
      }
      if (resizeObjects(opts.current.doc, rects) === 0) {
        finish(false);
        return;
      }
      current.box = to;
      setBox(to);
    }
  }, [finish]);

  const onPointerUp = useCallback(() => finish(true), [finish]);
  const onPointerCancel = useCallback(() => finish(false), [finish]);

  const begin = useCallback(
    (next: Active) => {
      active.current = next;
      setMode(next.mode);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    },
    [onPointerMove, onPointerUp, onPointerCancel],
  );

  // A gesture that outlives its objects, or this page's right to edit, is over.
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    },
    [onPointerMove, onPointerUp, onPointerCancel],
  );

  /** The objects a gesture acts on, and where they were when it began. */
  const groupFor = useCallback(
    (wanted: ReadonlySet<string>): { ids: string[]; base: Map<string, Rect>; minSizes: number[] } => {
      const base = new Map<string, Rect>();
      const minSizes: number[] = [];
      for (const object of opts.current.objects) {
        if (!wanted.has(object.id)) continue;
        base.set(object.id, objectBounds(object));
        minSizes.push(getObjectType(object.type)?.minSize ?? 0);
      }
      return { ids: [...base.keys()], base, minSizes };
    },
    [],
  );

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      // The board must not pan under a pressed object, and the marquee must not
      // start (story 2's `sticky.no_pan`, now generic).
      event.stopPropagation();
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (!opts.current.editable) return;
      if (active.current) return;
      // Dragging a member of the selection moves the whole selection; dragging an
      // object outside it moves that object alone.
      const selected = opts.current.selectedIds;
      const inSelection = selected.has(id);
      const { ids, base, minSizes } = groupFor(inSelection ? selected : new Set([id]));
      if (base.size === 0) return;
      begin({
        mode: 'pressed',
        id,
        handle: 'se',
        ids,
        base,
        baseBox: unionRects([...base.values()]),
        aspectLocked: false,
        minSizes,
        start: { x: event.clientX, y: event.clientY },
        box: null,
        toggleSelection: event.shiftKey,
        selectOnDrag: !inSelection,
      });
    },
    [begin, groupFor],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, handle: Handle) => {
      event.stopPropagation();
      event.preventDefault();
      if (!opts.current.editable) return;
      if (active.current) return;
      const ids = [...opts.current.selectedIds];
      const { base, minSizes } = groupFor(new Set(ids));
      if (base.size === 0) return;
      const baseBox = unionRects([...base.values()]);
      if (!baseBox) return;
      // Every selected type must be resizable, and the proportions are locked
      // only when every one of them locks them. Shift inverts that, so a note can
      // be made rectangular and a shape square (PRD 7.3).
      const specs = ids.map((id) => getObjectType(objectTypeOf(opts.current.objects, id)));
      if (specs.some((spec) => spec === undefined || !spec.resizable)) return;
      const locked = specs.every((spec) => spec?.aspectLocked);
      begin({
        mode: 'resizing',
        id: null,
        handle,
        ids: [...base.keys()],
        base,
        baseBox,
        aspectLocked: event.shiftKey ? !locked : locked,
        minSizes,
        start: { x: event.clientX, y: event.clientY },
        box: baseBox,
        toggleSelection: false,
        selectOnDrag: false,
      });
      opts.current.onGestureStart?.();
      setBox(baseBox);
    },
    [begin, groupFor],
  );

  return { mode, box, onObjectPointerDown, onHandlePointerDown };
}

function objectTypeOf(objects: readonly ObjectSnapshot[], id: string): string {
  return objects.find((object) => object.id === id)?.type ?? '';
}
