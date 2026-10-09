import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  anchoredRect,
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
import type { Selection } from './useSelection';

/** What the hook knows about the board it is moving things on. */
export interface TransformGestureOptions {
  readonly doc: Y.Doc;
  readonly camera: Camera;
  readonly selection: Selection;
  readonly snapshot: readonly ObjectSnapshot[];
  /** A board that failed to load is shown, and nothing on it is written (story 4). */
  readonly canEdit: boolean;
  /**
   * Called once when a press turns into a real gesture (past `DRAG_THRESHOLD_PX`), and
   * `onGestureEnd` once more when it is over — nothing in between. Story 8 wraps a gesture
   * in one undo step with these (TC-26).
   */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** Press on an object: selects it if it is not selected, then may start a group move. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Press on one of the selection's 8 handles: may start a group resize. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  /** True between the threshold crossing and the release; objects render themselves pressed. */
  readonly dragging: boolean;
}

/** One press, from the pointer going down to it coming up again. */
interface Gesture {
  readonly pointerId: number;
  readonly kind: 'move' | 'resize';
  handle: Handle;
  /** Where the pointer went down, in screen pixels. */
  readonly origin: Point;
  /** The selection's bounding box, when the resize began (null for a move). */
  box: Rect | null;
  /** Where every selected object was when the gesture started (key decision 1). */
  readonly starts: Map<string, Rect>;
  /** The objects this gesture is writing, as the snapshot ordered them at the start. */
  ids: string[];
  /**
   * What the press selected, decided when the pointer went down: the objects the selection
   * held then, or just the one object that was pressed. It is captured there and not read
   * from React at the first `pointermove`, because a pointerdown's state update has not
   * necessarily been applied by the time the pointer moves — and the pointer moves right
   * away, whatever React is doing about it.
   */
  readonly pressed: string[] | null;
  /** False until the pointer has moved far enough for this to be a gesture, not a click. */
  started: boolean;
}

function zoomOf(camera: Camera): number {
  return camera.zoom > 0 ? camera.zoom : 1;
}

function distance(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** True when at least one selected object's type may be resized (unknown types: no). */
function selectionIsResizable(
  snapshot: readonly ObjectSnapshot[],
  ids: ReadonlySet<string>,
): boolean {
  return snapshot.some((object) => ids.has(object.id) && getObjectType(object.type)?.resizable === true);
}

/**
 * The one gesture that moves and resizes objects, whatever type they are.
 *
 * It takes over what story 2 wrote inside `StickyNote` about dragging, because story 7 has
 * to do it to several objects of several types at once (sel.all_types): a sticky note hands
 * over its `pointerdown`, and so does every type stories 9–12 add.
 *
 * Three things are deliberate. **Absolute writes** — a gesture remembers where each object
 * was when it started and each frame writes `start + delta`, never "where it is now plus
 * this frame's delta", so two people moving the same object converge instead of each adding
 * their own deltas forever. **One selection-wide scale** for a resize, so the group stops as
 * soon as the first object reaches its limit rather than the objects drifting apart as each
 * hits its own. **Nothing about the selection** except the one case the PRD asks for:
 * pressing an object that is not selected selects it alone before moving it (TC-23).
 *
 * Writes are coalesced to about one per animation frame: the first move of a frame writes
 * through immediately, later ones are folded into the frame already scheduled, so a fast
 * mouse cannot push more changes into the document than the screen can show.
 */
export function useTransformGesture({
  doc,
  camera,
  selection,
  snapshot,
  canEdit,
  onGestureStart,
  onGestureEnd,
}: TransformGestureOptions): TransformGesture {
  const [dragging, setDragging] = useState(false);
  // Everything a pointer handler needs once the render that installed it is over.
  const live = useRef({ doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd });
  live.current = { doc, camera, selection, snapshot, canEdit, onGestureStart, onGestureEnd };

  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const release = useRef<(() => void) | null>(null);

  /** Run one write now, or fold it into the animation frame that is already waiting. */
  const write = useCallback((apply: () => void): void => {
    if (frame.current === null) {
      apply();
      if (typeof requestAnimationFrame !== 'function') return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const next = pending.current;
        pending.current = null;
        if (next) next();
      });
      return;
    }
    pending.current = apply;
  }, []);

  /** The pointer's last position is the truth, so a pending write is not left unsaid. */
  const flushPending = useCallback((): void => {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame.current);
    }
    frame.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) next();
  }, []);

  const stop = useCallback((): void => {
    const started = gesture.current?.started === true;
    release.current?.();
    release.current = null;
    gesture.current = null;
    if (started) {
      setDragging(false);
      live.current.onGestureEnd?.();
    }
  }, []);

  /** Say what the gesture is going to change, once (TC-26). */
  const begin = useCallback((current: Gesture): void => {
    const { snapshot: objects, doc: board } = live.current;
    const byId = new Map(objects.map((object) => [object.id, object]));
    // Objects somebody deleted in the meantime are dropped now; ones that go missing
    // during the gesture are skipped by the group operations themselves.
    current.ids = (current.pressed ?? [...live.current.selection.ids]).filter((id) => byId.has(id));
    current.starts.clear();
    for (const id of current.ids) current.starts.set(id, objectBounds(byId.get(id)!));
    current.box = unionRects([...current.starts.values()]);
    current.started = true;
    live.current.onGestureStart?.();
    setDragging(true);
    if (current.kind === 'move') {
      // A group move lifts the whole selection above the unselected objects, keeping the
      // order among them (key decision 4).
      bringObjectsToFront(board, current.ids);
    }
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent, shiftKey: boolean): void => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.origin.x;
      const dy = event.clientY - current.origin.y;
      if (!current.started) {
        // Under the threshold this is still a click (TC-23): nothing written, nothing
        // announced.
        if (distance(dx, dy) < DRAG_THRESHOLD_PX) return;
        begin(current);
      }
      if (current.ids.length === 0) return;
      const zoom = zoomOf(live.current.camera);
      const offset = { x: dx / zoom, y: dy / zoom };
      if (current.kind === 'move') {
        // Every object keeps its size and takes the same offset.
        const positions = new Map<string, Point>();
        for (const id of current.ids) {
          const start = current.starts.get(id);
          if (start) positions.set(id, { x: start.x + offset.x, y: start.y + offset.y });
        }
        write(() => {
          moveObjects(live.current.doc, positions);
        });
        return;
      }
      const box = current.box;
      if (box === null) return;
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      const aspectLocked = shiftKey || current.ids.some((id) => isAspectLocked(live.current, id));
      for (const id of current.ids) {
        const start = current.starts.get(id);
        if (!start) continue;
        rects.push(start);
        minSizes.push(minSizeOf(live.current, id));
      }
      // The bounding box is resized from the corner or edge opposite the handle, then the
      // scale is limited once for the whole selection.
      const proposed = resizeRect(box, current.handle, offset, aspectLocked);
      let scale = {
        x: box.width > 0 ? proposed.width / box.width : 1,
        y: box.height > 0 ? proposed.height / box.height : 1,
      };
      scale = clampScale(scale, rects, minSizes, MAX_OBJECT_SIZE_WORLD);
      if (aspectLocked) {
        // One scale for both axes, so a locked selection never distorts (key decision 2).
        const uniform = Math.min(scale.x, scale.y);
        scale = { x: uniform, y: uniform };
      }
      const to = anchoredRect(box, current.handle, box.width * scale.x, box.height * scale.y);
      const next = new Map<string, Rect>();
      current.ids.forEach((id) => {
        const start = current.starts.get(id);
        if (start) next.set(id, scaleWithin(start, box, to));
      });
      write(() => {
        resizeObjects(live.current.doc, next);
      });
    },
    [begin, write],
  );

  const onPointerMoveEvent = useCallback(
    (event: PointerEvent): void => {
      onPointerMove(event, event.shiftKey);
    },
    [onPointerMove],
  );

  const endOnPointer = useCallback(
    (event: PointerEvent): void => {
      if (gesture.current?.pointerId !== event.pointerId) return;
      // The last position the pointer reported stays applied — a release or a cancel
      // rolls nothing back (error path: "gesture cancelled → last applied kept").
      flushPending();
      stop();
    },
    [flushPending, stop],
  );

  const listen = useCallback((): void => {
    if (release.current) return;
    const onMove = (event: PointerEvent): void => onPointerMoveEvent(event);
    const onUp = (event: PointerEvent): void => endOnPointer(event);
    const onCancel = (event: PointerEvent): void => endOnPointer(event);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    release.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [endOnPointer, onPointerMoveEvent]);

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame.current);
      }
      frame.current = null;
      pending.current = null;
    },
    [],
  );

  const press = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string | null, handle: Handle | null): void => {
      if (event.pointerType === 'touch') return; // touch input is out of scope for this story
      if (event.button !== 0) return;
      const shift = event.shiftKey;
      if (!live.current.canEdit) {
        // A board that could not be loaded still selects, and never writes (TC-25).
        if (id !== null && handle === null) {
          if (shift) live.current.selection.toggle(id);
          else live.current.selection.click(id);
        }
        return;
      }
      if (handle === null) {
        if (id === null) return;
        if (shift) {
          // Shift+click adds the object to the selection, or takes it back out again.
          live.current.selection.toggle(id);
        } else if (!live.current.selection.ids.has(id)) {
          // Pressing an object outside the selection selects it alone first, so exactly what
          // the pointer is on moves (TC-23).
          live.current.selection.click(id);
        }
      } else if (
        !selectionIsResizable(live.current.snapshot, live.current.selection.ids)
      ) {
        // No selected type may be resized: no handles are shown, and a press that reaches
        // one anyway does nothing.
        return;
      }
      // What this press is about to move, decided now (see `Gesture.pressed`). The Shift
      // case works out its own answer rather than reading the selection back, because the
      // `toggle` dispatched above has not been applied yet.
      let pressed: string[] | null = null;
      if (handle === null && id !== null) {
        const selected = live.current.selection.ids;
        if (shift) {
          pressed = selected.has(id)
            ? [...selected].filter((entry) => entry !== id)
            : [...selected, id];
        } else {
          pressed = selected.has(id) ? [...selected] : [id];
        }
      }
      gesture.current = {
        pointerId: event.pointerId,
        kind: handle === null ? 'move' : 'resize',
        handle: handle ?? ('se' as Handle),
        origin: { x: event.clientX, y: event.clientY },
        box: null,
        starts: new Map<string, Rect>(),
        ids: [],
        pressed,
        started: false,
      };
      listen();
    },
    [listen],
  );

  return {
    onObjectPointerDown: (event, id) => press(event, id, null),
    onHandlePointerDown: (event, handle) => press(event, null, handle),
    dragging,
  };
}

/** The type's own minimum size, or 0 when nothing declared one (an unknown type). */
function minSizeOf(
  live: { snapshot: readonly ObjectSnapshot[] },
  id: string,
): number {
  const object = live.snapshot.find((entry) => entry.id === id);
  return object ? getObjectType(object.type)?.minSize ?? 0 : 0;
}

/** Does this object's type keep its proportions? */
function isAspectLocked(
  live: { snapshot: readonly ObjectSnapshot[] },
  id: string,
): boolean {
  const object = live.snapshot.find((entry) => entry.id === id);
  return getObjectType(object?.type ?? '')?.aspectLocked === true;
}
