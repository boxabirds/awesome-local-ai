/**
 * The gesture that moves and resizes objects.
 *
 * One hook does both, because they are the same gesture with different starting points: a press on an
 * object's body moves the selection, a press on one of the handles around it resizes the selection,
 * and both have to answer the same four questions the same way — how far has the pointer travelled,
 * which objects is it acting on, what may those objects be scaled to, and when does the gesture end?
 *
 * **Absolute writes, never increments.** Every frame writes the rect an object should now have, worked
 * out from where it was when the gesture started plus how far the pointer has travelled since. The
 * obvious alternative — remember last frame's write and add this frame's movement to it — drifts the
 * moment a colleague moves the same object mid-drag, because the two writers are then adding to
 * different things. With absolute writes the last writer wins, and every screen agrees on where the
 * object ended up.
 *
 * **The threshold belongs here, not in the object.** A press becomes a move only after
 * DRAG_THRESHOLD_PX of travel; before that it is a click, and a click has to survive a pointer that
 * lands a pixel or two off target and comes back. Objects therefore report their press and forget
 * about it: the answer to "is this still a press?" has exactly one owner.
 *
 * **One `bringObjectsToFront` per gesture, fired when a press turns into a move** — not on press,
 * because a click must not reorder the board, and not every frame, because a reorder only has to
 * happen once to be right. Dragging a group past another object must not change which of two dragged
 * objects is on top.
 *
 * **The listeners live on the window**, and are installed for the length of the gesture rather than
 * the length of a render. A note dragged under the toolbar or off the edge of the window keeps its
 * drag, and the release is still heard wherever it lands — which pointer capture cannot promise for an
 * element that is being moved out from under the pointer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { bringObjectsToFront, moveObjects, resizeObjects } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import type { Handle, Point, Rect } from '../../shared/geometry';
import {
  anchorPoint,
  boxFromAnchor,
  clampScale,
  normalizeRect,
  resizeRect,
  scaleWithin,
  unionRects,
} from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import type { ObjectInteraction } from '../objects/objectProps';
import { describeSelection, getObjectType } from '../objects/registry';
import { isTypingTarget } from './useBoardKeys';

import type { Selection } from './useSelection';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: Selection;
  /** Everything on the board, because a gesture acts on the selection drawn from it. */
  snapshot: readonly ObjectSnapshot[];
  /** Whether this person may write. A board that cannot be written to does not answer to the pointer. */
  canEdit: boolean;
  /**
   * Called once when a press becomes a gesture and once when that gesture ends. Story 8 puts its undo
   * boundary here: a group move is one thing to undo, not one thing per frame.
   */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGesture {
  /** A press on an object's body: selects it if it is not selected, then moves the selection. */
  onObjectPointerDown(event: PointerEvent | ReactPointerEvent, id: string): void;
  /** A press on one of the selection's resize handles. */
  onHandlePointerDown(event: PointerEvent | ReactPointerEvent, handle: Handle): void;
  /** What the pointer is doing, and to which object. */
  interaction: ObjectInteraction;
  interactingId: string | null;
  /** Whether a gesture of either kind is in flight, past the threshold. */
  active: boolean;
}

/** Which objects a press on `id` will act on, in the order the document holds them. */
function targetsFor(snapshot: readonly ObjectSnapshot[], selection: Selection, id: string): ObjectSnapshot[] {
  // The selection read here is the one from before this press, which is exactly right: pressing an
  // object that was not selected moves that object alone, and pressing one that was moves the group.
  if (selection.ids.has(id)) return snapshot.filter((object) => selection.ids.has(object.id));
  return snapshot.filter((object) => object.id === id);
}

/** The rect an object is drawn at, or null when its type is one that cannot be resized at all. */
function rectOf(object: ObjectSnapshot): Rect | null {
  const spec = getObjectType(object.type);
  if (spec === undefined || !spec.resizable) return null;
  return normalizeRect({ x: object.x, y: object.y }, { x: object.x + object.width, y: object.y + object.height });
}

function sameRect(a: Rect | undefined, b: Rect): boolean {
  return (
    a !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/**
 * A gesture in flight. Held in a ref, not in state: it is read on every pointer event and only
 * *displayed* twice per gesture, so state here would re-render the board on every frame whether any
 * part of the board had changed or not.
 */
interface Gesture {
  pointerId: number;
  /** The handle being dragged, or null for a move. */
  handle: Handle | null;
  /** The object the pointer was pressed on, which is the one the outlines are attributed to. */
  pressedId: string;
  /** The objects being moved or resized. */
  objects: ObjectSnapshot[];
  /** Where each of them was when the gesture started. */
  startRects: Map<string, Rect>;
  /** The selection's bounding box at the start, which is what a handle drags. */
  startBox: Rect | null;
  /** Where the pointer went, in screen and in board units, from the last event we were told about. */
  pointerScreen: Point;
  /** Where the press landed, in screen units: travel is measured from here, in pixels. */
  startScreen: Point;
  origin: Point;
  /** The smallest each object may be scaled to, in the order of `objects`. */
  minSizes: number[];
  /** The last rect written for each object, so a frame that changed nothing writes nothing. */
  last: Map<string, Rect>;
  /** Whether the selection keeps its proportions; decided once, when the drag begins. */
  aspect: boolean;
  /** Past the threshold. */
  moving: boolean;
  /** A frame is already on its way. */
  scheduled: boolean;
  /** `onGestureStart` has been called, so `onGestureEnd` is owed exactly one call. */
  started: boolean;
}

/** Listeners that exist for the length of a gesture rather than the length of a render. */
interface WindowListeners {
  move(event: PointerEvent): void;
  up(): void;
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
  const [interaction, setInteraction] = useState<ObjectInteraction>('idle');
  const [interactingId, setInteractingId] = useState<string | null>(null);

  // Everything the listeners need, kept in refs so a gesture started before a re-render is never
  // carrying a camera, a selection or a board that has since changed.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const hooksRef = useRef({ onGestureStart, onGestureEnd });
  hooksRef.current = { onGestureStart, onGestureEnd };

  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const listeners = useRef<WindowListeners | null>(null);
  /**
   * The object the pointer went down on, and whether it was already one of the selected ones at that
   * moment. That is the only place the difference between "click one object of a cluster" and "pick the
   * cluster up" can be settled: it has to be recorded when the pointer goes down, because by the time it
   * comes back the selection may have been changed by the press itself.
   */
  const pressed = useRef<{ id: string; pointerId: number; wasSelected: boolean } | null>(null);

  const show = useCallback((phase: ObjectInteraction, id: string | null): void => {
    setInteraction(phase);
    setInteractingId(phase === 'idle' ? null : id);
  }, []);

  /**
   * The frame body: write where the objects should be, given where the pointer is now. A move writes
   * positions; a resize writes rects scaled from the bounding box. Either way, only the objects whose
   * rect actually changed are handed to the document.
   */
  const write = useCallback((): boolean => {
    const current = gesture.current;
    if (current === null) return false;
    const zoom = cameraRef.current.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) return false;

    const pointer = screenToWorld(cameraRef.current, current.pointerScreen);
    const delta = { x: pointer.x - current.origin.x, y: pointer.y - current.origin.y };
    // An object a colleague deleted mid-gesture is left out of the write rather than resurrected by
    // it; the rest of the group carries on as if it had never been there, which is what it is now.
    const stillThere = (id: string): boolean => snapshotRef.current.some((object) => object.id === id);

    if (current.handle === null || current.startBox === null) {
      const positions = new Map<string, Rect>();
      for (const object of current.objects) {
        const start = current.startRects.get(object.id);
        if (start === undefined || !stillThere(object.id)) continue;
        const next = { x: start.x + delta.x, y: start.y + delta.y, width: start.width, height: start.height };
        if (sameRect(current.last.get(object.id), next)) continue;
        current.last.set(object.id, next);
        positions.set(object.id, next);
      }
      if (positions.size === 0) return false;
      return moveObjects(doc, positions) > 0;
    }

    // The bounding box is resized by the handle, clamped, and every object is scaled inside the box
    // that is left. One scale for the whole selection is what keeps a cluster a cluster: objects that
    // stopped at their own limits individually would leave the layout distorted.
    const dragged = resizeRect(current.startBox, current.handle, delta, current.aspect);
    const scales = clampScale(
      { x: dragged.width / current.startBox.width, y: dragged.height / current.startBox.height },
      current.objects.map((object) => current.startRects.get(object.id)).filter((rect): rect is Rect => rect !== undefined),
      current.minSizes,
      MAX_OBJECT_SIZE_WORLD,
    );
    const box = boxFromAnchor(
      current.handle,
      anchorPoint(current.startBox, current.handle),
      current.startBox.width * scales.x,
      current.startBox.height * scales.y,
    );

    const rects = new Map<string, Rect>();
    for (const object of current.objects) {
      const start = current.startRects.get(object.id);
      if (start === undefined || !stillThere(object.id)) continue;
      const next = scaleWithin(start, current.startBox, box);
      if (sameRect(current.last.get(object.id), next)) continue;
      current.last.set(object.id, next);
      rects.set(object.id, next);
    }
    if (rects.size === 0) return false;
    return resizeObjects(doc, rects) > 0;
  }, [doc]);

  const stopFrame = useCallback((): void => {
    if (frame.current !== 0) cancelAnimationFrame(frame.current);
    frame.current = 0;
    const current = gesture.current;
    if (current !== null) current.scheduled = false;
  }, []);

  const schedule = useCallback((): void => {
    const current = gesture.current;
    if (current === null || current.scheduled) return;
    current.scheduled = true;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const active = gesture.current;
      if (active !== null) active.scheduled = false;
      write();
    });
  }, [write]);

  const onPointerMove = useCallback(
    (event: PointerEvent): void => {
      const current = gesture.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      current.pointerScreen = { x: event.clientX, y: event.clientY };

      if (!current.moving) {
        const travelled = Math.max(
          Math.abs(event.clientX - current.startScreen.x),
          Math.abs(event.clientY - current.startScreen.y),
        );
        if (travelled < DRAG_THRESHOLD_PX) return;
        // The press has become a gesture: this is the first moment the board is written to, the
        // moment the selection goes to the front, and the moment the outlines change appearance.
        current.moving = true;
        current.aspect =
          event.shiftKey || (current.handle !== null && describeSelection(current.objects).aspectLocked);
        hooksRef.current.onGestureStart?.();
        current.started = true;
        if (current.handle === null) bringObjectsToFront(doc, current.objects.map((object) => object.id));
        show('dragging', current.pressedId);
      }
      schedule();
    },
    [doc, show],
  );

  const uninstall = useCallback((): void => {
    const installed = listeners.current;
    if (installed === null) return;
    window.removeEventListener('pointermove', installed.move);
    window.removeEventListener('pointerup', installed.up);
    window.removeEventListener('pointercancel', installed.up);
    listeners.current = null;
  }, []);

  const finish = useCallback((): void => {
    const current = gesture.current;
    if (current === null) return;
    uninstall();
    stopFrame();
    // Whatever the pointer did last has to land, but only if the press ever became a gesture. The
    // throttling that kept the document quiet during a drag would otherwise drop the final position, and
    // a note dropped at 99% of its journey looks, and reads, like a note that was never dragged at all.
    // A press that travelled a pixel and came back is a click, and a click that wrote the note a couple
    // of units off where it was would be a note that shifts every time anybody selects it.
    if (current.moving) write();

    // A press that never travelled is a click, and a click on an object means *that object*: if it was
    // already part of a selection of several, it is the only one left afterwards. It cannot be narrowed
    // when the pointer goes down — that is the moment at which "press one object of a cluster and the
    // cluster moves" is decided, and narrowing there would drag one note out of five and leave four
    // standing where they were. It happens here, once it is known that nothing was dragged.
    const press = pressed.current;
    pressed.current = null;
    if (press !== null && press.pointerId === current.pointerId && !current.moving && press.wasSelected) {
      selectionRef.current.click(press.id);
    }

    gesture.current = null;
    if (current.started) hooksRef.current.onGestureEnd?.();
    show('idle', null);
  }, [show, stopFrame, uninstall, write]);

  const install = useCallback((): void => {
    if (listeners.current !== null) return;
    const move = (event: PointerEvent): void => {
      onPointerMove(event);
    };
    const up = (): void => {
      finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    listeners.current = { move, up };
  }, [finish, onPointerMove]);

  const begin = useCallback(
    (event: PointerEvent | ReactPointerEvent, id: string, handle: Handle | null, phase: ObjectInteraction): void => {
      const snapshotNow = snapshotRef.current;
      const objects =
        handle === null ? targetsFor(snapshotNow, selectionRef.current, id) : selectionRef.current.selected;
      if (objects.length === 0) return;

      const startRects = new Map<string, Rect>();
      const minSizes: number[] = [];
      const movable: ObjectSnapshot[] = [];
      for (const object of objects) {
        const rect = rectOf(object);
        // An object of a type that cannot be resized takes no part in a gesture; the others carry on
        // without it rather than the whole gesture being refused.
        if (rect === null) continue;
        startRects.set(object.id, rect);
        minSizes.push(getObjectType(object.type)?.minSize ?? 0);
        movable.push(object);
      }
      if (startRects.size === 0) return;

      const screen = { x: event.clientX, y: event.clientY };
      gesture.current = {
        pointerId: event.pointerId,
        handle,
        pressedId: id,
        objects: movable,
        startRects,
        startBox: handle === null ? null : unionRects([...startRects.values()]),
        pointerScreen: screen,
        startScreen: screen,
        origin: screenToWorld(cameraRef.current, screen),
        minSizes,
        last: new Map(),
        aspect: false,
        moving: false,
        scheduled: false,
        started: false,
      };
      install();
      show(phase, id);
    },
    [install, show],
  );

  const onObjectPointerDown = useCallback(
    (event: PointerEvent | ReactPointerEvent, id: string): void => {
      // A board that cannot be written to does not answer to the pointer at all: no selection change,
      // no press, nothing.
      if (!canEditRef.current) return;
      const selection = selectionRef.current;

      // Shift (or Ctrl/Cmd) means "say something about the selection", not "move something": the object
      // joins it, or leaves it if it was already in. No gesture starts from such a press, so a person
      // adding a fifth note to four does not also move that note. The keys are read from the event rather
      // than turned into separate callbacks, so an object drawn by a story that has not been written yet
      // gets the same behaviour by handing the press over, and cannot get it wrong.
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && !isTypingTarget(event.target)) {
        selection.toggle(id);
        return;
      }

      // An object outside the selection is chosen by this press, which then moves that one object on its
      // own. An object already in the selection is left as it is, so pressing one object of a cluster
      // picks the whole cluster up.
      const wasSelected = selection.ids.has(id);
      if (!wasSelected) selection.click(id);
      pressed.current = { id, pointerId: event.pointerId, wasSelected };
      begin(event, id, null, 'pressed');
    },
    [begin],
  );

  const onHandlePointerDown = useCallback(
    (event: PointerEvent | ReactPointerEvent, handle: Handle): void => {
      if (!canEditRef.current) return;
      // A handle sits over an object; the press must not be taken as a press on that object, which
      // would select it and start a move instead of a resize.
      event.stopPropagation();
      pressed.current = null;
      const first = selectionRef.current.selected[0];
      if (first === undefined) return;
      begin(event, first.id, handle, 'resizing');
    },
    [begin],
  );

  // A gesture whose objects have all gone is over, whoever took them. Without this the pointer would
  // still be dragging, and letting go would still call the gesture-finished hook for a gesture that
  // is no longer happening.
  useEffect(() => {
    const current = gesture.current;
    if (current === null || !current.moving) return;
    if (current.objects.some((object) => snapshot.some((candidate) => candidate.id === object.id))) return;
    uninstall();
    stopFrame();
    gesture.current = null;
    if (current.started) hooksRef.current.onGestureEnd?.();
    show('idle', null);
  }, [show, snapshot, stopFrame, uninstall]);

  // A gesture must not outlive the screen it was dragged on: the frame and the listeners go with it.
  useEffect(
    () => () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
      uninstall();
    },
    [uninstall],
  );

  return {
    onObjectPointerDown,
    onHandlePointerDown,
    interaction,
    interactingId,
    // Answered from state rather than from the ref: a ref read during a render says nothing about the
    // next one, and this question is asked by things that get drawn.
    active: interaction === 'dragging' || interaction === 'resizing',
  };
}
