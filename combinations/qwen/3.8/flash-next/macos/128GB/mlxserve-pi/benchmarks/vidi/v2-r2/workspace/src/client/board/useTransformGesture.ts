// The board's transform gesture (story 7): one pointer press that becomes a
// group move, and the resize handles that become a group resize.
//
// Why a board-level hook instead of per-note drag code: the object under the
// pointer is only the *anchor*. What moves is the whole selection - one, three
// or thirty objects - and the maths has to happen for the group as a whole
// (every object shifts by the same world delta; every object scales by the
// same factor around the same anchor). A per-object component cannot do that
// without knowing about its neighbours, so the gesture lives where the
// selection lives.
//
// The press states, per gesture:
//   Pressed          pointer down on an object, under DRAG_THRESHOLD_PX of travel
//   Dragging         the travel passed the threshold: the subject is transforming
//   Selected         the press ended without travel: the click selected - or,
//                    for a press on an already-selected member of a group,
//                    collapsed the group to just this object
// Press and Dragging both write; Selected writes nothing. A press that ends
// is forget(): the gesture keeps no state after it, so a later deletion or
// zoom change cannot confuse a leftover.
//
// The subject of a drag is decided once, at pointerdown: the whole selection
// if the anchor was already in it, otherwise just the anchor (which the press
// selects at once). The selection itself does not change again until the
// press ends - a drag of a group must not dissolve because one member slid
// out from under the pointer.
//
// Live writes: every pointermove writes the group to the document inside its
// own single transaction (one undo unit for story 8, one update for story 3).
// If the anchor object is deleted by a remote peer mid-drag, the model simply
// skips the gone id and the gesture notices nothing special; the pointerup -
// wherever it lands - ends the gesture. (When the deleted element is gone,
// its own handlers are gone with it, exactly like before story 7: no event
// that only the dead element could receive ever arrives.)

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import {
  anchorBox,
  clampScale,
  resizeRect,
  scaleWithin,
  unionRects,
  type Handle,
  type Point,
  type Rect,
} from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionState } from './useSelection';


export interface TransformGestureOptions {
  doc: Y.Doc;
  /** The live selection, read at pointerdown to decide the subject. */
  selection: SelectionState;
  /** The live object snapshots, of every type, for their starting rects. */
  objects: readonly ObjectSnapshot[];
  /** Board zoom: screen pixels become world units by dividing by it. */
  zoom: number;
  /** A locked board takes no transforms at all. */
  editable: boolean;
  /** Ask the board to select (additive false) or toggle (additive true). */
  onSelect(id: string, additive: boolean): void;
  /**
   * Notified once when a press becomes a transform (threshold crossed, or a
   * handle grabbed) and once when that transform ends - for anything (board
   * chrome, tests) that watches "the board is being transformed" as a state.
   */
  onGestureStart?(): void;
  onGestureEnd?(): void;
  /**
   * Re-measure these text objects after a transform wrote their box (story 9). A
   * text's height is its content's, so a resize that scaled a text's box has to be
   * followed by the layout, which is the only thing that knows how many lines the
   * text now makes. The board hands over the measurer; the gesture only says which
   * objects it just moved. It is called inside the same undo capture window as the
   * transform, so a resize and the box that follows it are one undo step.
   */
  remeasureTexts?(ids: readonly string[]): void;
}

export interface TransformGesture {
  /** The object element's onPointerDown handler, bound to its id. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string): void;
  /** A resize handle's onPointerDown handler, bound to its handle. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
  /** The ids the gesture is currently transforming; the board marks them. */
  draggingIds: ReadonlySet<string>;
  /**
   * True while a press the gesture took is in flight. The board uses it to
   * keep a note's arrival of focus from the same mouse press from replacing
   * the selection the gesture just made: a click that grabbed a group must
   * not collapse it the instant later, when the browser moves focus.
   */
  isPressed(): boolean;
}

/** One in-flight gesture. Everything in it is a start value; live maths reads it. */
interface GesturePress {
  mode: 'move' | 'resize';
  pointerId: number;
  /** The object the pointer went down on (move), or the first selected id. */
  anchorId: string;
  /** Everything that will be transformed - decided once, at pointerdown. */
  subject: string[];
  /** Screen position of the pointer at the start. */
  pointerX: number;
  pointerY: number;
  /** Where each subject object was, and how big it was, at the start. */
  startRects: Map<string, Rect>;
  /** The union box the resize started from. */
  startBox: Rect | null;
  /** Per-subject minimum edges, same order as the union's constituent rects. */
  minSizes: number[];
  /** True when every subject's type keeps its ratio under a corner resize. */
  aspectLocked: boolean;
  /** The handle being dragged (resize only). */
  handle: Handle | null;
  /** True once the pointer travelled enough to be a transform, not a click. */
  moved: boolean;
  /**
   * The objects in the subject whose height is their text's - texts - whose box
   * the layout has to be asked about again after the transform wrote it.
   */
  textIds: string[];
  /**
   * The one text grabbed by one of the two handles that set a width, which is
   * resized sideways only. Empty for every other press.
   */
  sideHandleIds: string[];
}

const NO_DRAGGING: ReadonlySet<string> = new Set<string>();

function sameDrag(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function useTransformGesture(options: TransformGestureOptions): TransformGesture {
  // The newest options in a ref: listeners attached at pointerdown must never
  // run against a stale document, zoom or selection - the way StickyNote's
  // zoomRef works for the same reason.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(NO_DRAGGING);
  const pressRef = useRef<GesturePress | null>(null);
  // True from the moment a pointerdown has moved the selection until the
  // event loop turn after it. A real browser gives the pressed note keyboard
  // focus as the default action of that same pointerdown - after the JS
  // handlers, and after any microtask - and that focus must not undo the
  // selection the gesture just made. Only a later Tab-focus task sees false.
  const selectionHandledRef = useRef(false);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
  } | null>(null);

  const forget = useCallback((): void => {
    const listeners = listenersRef.current;
    if (listeners !== null) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.up);
      window.removeEventListener('pointercancel', listeners.cancel);
      listenersRef.current = null;
    }
    pressRef.current = null;
    setDraggingIds((previous) => (previous.size === 0 ? previous : NO_DRAGGING));
  }, []);

  // A gesture that outlived the board (unmount mid-drag) leaves no listeners.
  useEffect(() => forget, [forget]);

  const begin = useCallback(
    (press: GesturePress): void => {
      pressRef.current = press;
      setDraggingIds((previous) => {
        const next = new Set(press.subject);
        return sameDrag(previous, next) ? previous : next;
      });
    },
    [],
  );

  // --- one frame of a transform ----------------------------------------------
  const frame = useCallback(
    (clientX: number, clientY: number): void => {
      const press = pressRef.current;
      if (press === null) return;
      const { doc, zoom } = optionsRef.current;
      const scale = zoom === 0 ? 1 : zoom;
      const world: Point = {
        x: (clientX - press.pointerX) / scale,
        y: (clientY - press.pointerY) / scale,
      };

      if (press.mode === 'move') {
        const positions = new Map<string, Point>();
        for (const [id, from] of press.startRects) {
          positions.set(id, { x: from.x + world.x, y: from.y + world.y });
        }
        // gone ids are skipped inside the model: if the anchor is one of them
        // this writes nothing, and the gesture rides on to a quiet end
        moveObjects(doc, positions);
        return;
      }

      const start = press.startBox;
      const handle = press.handle;
      if (start === null || handle === null) return;

      // One text, grabbed by a side handle (story 9): its height belongs to its
      // text, so the drag sets a fixed width and nothing else - the edge that was
      // not grabbed stays where it was, and the layout is called on the same frame
      // so the words are seen to wrap as the box narrows.
      if (press.sideHandleIds.length === 1 && press.subject.length === 1) {
        const id = press.subject[0];
        const from = press.startRects.get(id);
        if (from === undefined) return;
        const right = from.x + from.width;
        const asked = handle === 'e' ? from.width + world.x : right - (from.x + world.x);
        const min = press.minSizes[0] ?? TEXT_MIN_WIDTH_WORLD;
        const width = Math.min(Math.max(asked, min), MAX_OBJECT_SIZE_WORLD);
        setTextWidthFixed(doc, id, width);
        if (handle === 'w') {
          // the right edge did not move, so the left one takes up the whole change
          moveObjects(doc, new Map<string, Point>([[id, { x: right - width, y: from.y }]]));
        }
        optionsRef.current.remeasureTexts?.(press.sideHandleIds);
        return;
      }

      const rects: Rect[] = [];
      for (const id of press.subject) {
        const from = press.startRects.get(id);
        if (from !== undefined) rects.push(from);
      }
      const target = resizeRect(start, handle, world, press.aspectLocked);
      const asked = {
        x: start.width === 0 ? 1 : target.width / start.width,
        y: start.height === 0 ? 1 : target.height / start.height,
      };
      const allowed = clampScale(asked, rects, press.minSizes, MAX_OBJECT_SIZE_WORLD);
      const box = anchorBox(start, handle, allowed, press.aspectLocked);
      const writes = new Map<string, Rect>();
      for (const [id, from] of press.startRects) {
        writes.set(id, scaleWithin(from, start, box));
      }
      resizeObjects(doc, writes);
      // A group resize scales a text's box like any other box; its height is the
      // text's, so the layout is asked again - which also puts an auto-width text
      // back to the width of its own longest line. The font size is never part of
      // a resize, at any zoom, for any type.
      if (press.textIds.length > 0) optionsRef.current.remeasureTexts?.(press.textIds);
    },
    [],
  );

  const onMove = useCallback(
    (event: PointerEvent): void => {
      const press = pressRef.current;
      if (press === null || event.pointerId !== press.pointerId) return;
      const dx = event.clientX - press.pointerX;
      const dy = event.clientY - press.pointerY;
      if (!press.moved) {
        // under a few pixels the pointer is a click, not a move
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        press.moved = true;
        // Close any earlier undo step first, so the stacking write below and every
        // move frame that follows belong to this one drag (story 8).
        optionsRef.current.onGestureStart?.();
        if (press.mode === 'move') {
          // the selection comes above everything it does not contain, once
          bringObjectsToFront(optionsRef.current.doc, press.subject);
        }
      }
      frame(event.clientX, event.clientY);
    },
    [frame],
  );

  const finish = useCallback(
    (event: PointerEvent, cancelled: boolean): void => {
      const press = pressRef.current;
      if (press === null || event.pointerId !== press.pointerId) return;
      const wasMoved = press.moved;
      const anchorId = press.anchorId;
      forget();
      if (wasMoved) optionsRef.current.onGestureEnd?.();
      if (!wasMoved && press.mode === 'move') {
        // a press that went down on an already-selected member and never
        // travelled collapses the group onto it (and confirms the click that
        // selected a fresh object on pointerdown)
        optionsRef.current.onSelect(anchorId, false);
      }
      void cancelled;
    },
    [forget],
  );

  const attach = useCallback(
    (pointerId: number): void => {
      // the window, not the element: the object under the pointer may be
      // deleted mid-gesture, and the gesture must survive that
      const move = (event: PointerEvent): void => onMove(event);
      const up = (event: PointerEvent): void => finish(event, false);
      const cancel = (event: PointerEvent): void => finish(event, true);
      listenersRef.current = { move, up, cancel };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      void pointerId;
    },
    [onMove, finish],
  );

  const markSelectionHandled = useCallback((): void => {
    selectionHandledRef.current = true;
    // a macrotask: the default action of the pointerdown (focus) has run by
    // the time this fires, and no separate key event can have come between
    setTimeout(() => {
      selectionHandledRef.current = false;
    }, 0);
  }, []);

  // --- the two entries the board wires ---------------------------------------

  const onObjectPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, id: string): void => {
      const { selection, objects, editable, onSelect } = optionsRef.current;
      // Shift (or the Mac's Cmd) anywhere on a note adds or removes it, and
      // starts no drag: multi-selection is a sequence of clicks, not a gesture
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        onSelect(id, true);
        markSelectionHandled();
        return;
      }
      if (!editable) return;

      const alreadySelected = selection.ids.has(id);
      const subject = alreadySelected ? [...selection.ids] : [id];
      const startRects = new Map<string, Rect>();
      for (const subjectId of subject) {
        const object = objects.find((o) => o.id === subjectId);
        if (object !== undefined) startRects.set(subjectId, objectBounds(object));
      }
      // the press itself selects what was not selected yet: the pointer goes
      // down on the new thing and the old selection is gone before it moves
      if (!alreadySelected) onSelect(id, false);
      markSelectionHandled();

      event.currentTarget.setPointerCapture?.(event.pointerId);
      begin({
        mode: 'move',
        pointerId: event.pointerId,
        anchorId: id,
        subject,
        pointerX: event.clientX,
        pointerY: event.clientY,
        startRects,
        startBox: null,
        minSizes: [],
        aspectLocked: false,
        handle: null,
        moved: false,
        textIds: [],
        sideHandleIds: [],
      });
      attach(event.pointerId);
    },
    [attach, begin, markSelectionHandled],
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, handle: Handle): void => {
      const { selection, objects, editable } = optionsRef.current;
      if (!editable) return;
      const subject = [...selection.ids];
      if (subject.length === 0) return;

      const startRects = new Map<string, Rect>();
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      const textIds: string[] = [];
      let aspectLocked = true;
      for (const id of subject) {
        const object = objects.find((o) => o.id === id);
        if (object === undefined) continue;
        const rect = objectBounds(object);
        startRects.set(id, rect);
        rects.push(rect);
        const spec = getObjectType(object.type);
        if (spec === undefined || !spec.aspectLocked) aspectLocked = false;
        minSizes.push(spec?.minSize ?? STICKY_MIN_SIZE_WORLD);
        // Only a box whose height is its text's needs the layout asked again: a
        // text's two side handles set a width, and a group resize that scaled a text
        // has to have its box remeasured. A shape's box is its own - it is resized by
        // the generic path, like a note - and an arrow has no box to resize at all.
        if (spec !== undefined && spec.handles === 'horizontal') textIds.push(id);
      }
      if (rects.length === 0) return;

      event.currentTarget.setPointerCapture?.(event.pointerId);
      begin({
        mode: 'resize',
        pointerId: event.pointerId,
        anchorId: subject[0],
        subject,
        pointerX: event.clientX,
        pointerY: event.clientY,
        startRects,
        startBox: unionRects(rects),
        // the per-object minimums ride in the same order as the union's parts
        minSizes,
        aspectLocked,
        handle,
        moved: true, // a handle drag is never a click: it transforms at once
        // A type with handles of its own only answers to those: one text grabbed by
        // a side handle is a width, not a scale. A corner of a mixed group's box is a
        // group resize, and the layout follows it - which is what `textIds` is for.
        textIds,
        sideHandleIds: subject.length === 1 && (handle === 'e' || handle === 'w') ? textIds : [],
      });
      optionsRef.current.onGestureStart?.();
      attach(event.pointerId);
    },
    [attach, begin],
  );

  const isPressed = useCallback(
    (): boolean => pressRef.current !== null || selectionHandledRef.current,
    [],
  );

  return { onObjectPointerDown, onHandlePointerDown, draggingIds, isPressed };
}
