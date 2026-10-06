import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  bringObjectsToFront,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from "../../shared/board-model";
import {
  boxForScale,
  clampScale,
  scaleBetween,
  scaleWithin,
  unionRects,
  resizeRect,
  type Handle,
  type MinSize,
  type Point,
  type Rect,
} from "../../shared/geometry";
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from "../../shared/config";
import type { Camera } from "../canvas/camera";
import { getObjectType, type ObjectTypeSpec } from "../objects/registry";
import type { SelectionApi } from "./useSelection";

/**
 * The one gesture that transforms objects (`sel.transform`).
 *
 * It handles both cases a person can start a gesture on — an object (move the
 * whole selection) and a bounding-box handle (resize the whole selection) — and
 * it knows nothing about what kind of object it is holding: the registry says
 * whether the type is resizable, aspect-locked and how small it may go.
 *
 * Every write is **absolute** (`start + delta`, or the scaled rect), never an
 * accumulation of per-frame deltas. If somebody else moves the same object at
 * the same time, both clients converge on the last write and every screen ends
 * up in the same place (Key decision 1 in the design).
 */

/** What the gesture needs from a pointer event (React's or the browser's). */
export interface PointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly button: number;
  readonly pointerType?: string;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  /** False when this board could not be loaded (story 4): every gesture is refused. */
  canEdit: boolean;
  /** Story 8 groups a gesture into one undo step. Called exactly once per gesture. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export interface TransformGestureApi {
  /** An object component's own `pointerdown` hands over here. */
  onObjectPointerDown(event: PointerLike, id: string): void;
  /** A `SelectionOverlay` handle's `pointerdown` hands over here. */
  onHandlePointerDown(event: PointerLike, handle: Handle): void;
  /** Ids the gesture is currently transforming, for `data-dragging`. */
  readonly draggingIds: ReadonlySet<string>;
}

type Kind = "move" | "resize";

interface Gesture {
  kind: Kind;
  pointerId: number;
  el: HTMLElement;
  handle: Handle;
  aspectLocked: boolean;
  /** The object that was pressed, which a click (no movement) selects alone. */
  pressId: string;
  shiftKey: boolean;
  startX: number;
  startY: number;
  /** Ids this gesture transforms (the selection at press time). */
  ids: string[];
  /** Where each of them was when the gesture began. */
  startRects: Map<string, Rect>;
  /** The selection's bounding box at gesture start. */
  box: Rect | null;
  started: boolean;
  ended: boolean;
  frame: number | null;
  detach(): void;
}

/** Held while a frame is queued, replaced by the real handle. */
const PENDING_FRAME = -1;
const NO_IDS: ReadonlySet<string> = new Set<string>();

export function useTransformGesture(options: TransformGestureOptions): TransformGestureApi {
  const gestureRef = useRef<Gesture | null>(null);
  const [draggingIds, setDraggingIds] = useState<ReadonlySet<string>>(NO_IDS);

  // Latest values, so a listener attached at pointerdown never reads a stale
  // closure when the board re-rendered mid-gesture.
  const latest = useRef(options);
  latest.current = options;

  const detach = useCallback((gesture: Gesture | null) => {
    if (!gesture) return;
    gesture.detach();
    if (gesture.frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(gesture.frame);
    }
    gesture.frame = null;
  }, []);

  const finish = useCallback(
    (gesture: Gesture | null) => {
      if (!gesture || gesture.ended) return;
      gesture.ended = true;
      detach(gesture);
      if (gestureRef.current === gesture) gestureRef.current = null;
      if (gesture.started) {
        // The last applied state is kept, including when the gesture was
        // cancelled: a cancelled gesture is not an undo.
        latest.current.onGestureEnd?.();
        setDraggingIds(NO_IDS);
      }
    },
    [detach],
  );

  // Nothing may outlive the component (a listener left behind would write to a
  // document this screen no longer owns).
  useEffect(() => () => detach(gestureRef.current), [detach]);

  const applyFrame = useCallback(
    (gesture: Gesture) => {
      gesture.frame = null;
      const current = gestureRef.current;
      if (!current || current !== gesture || !current.started) return;

      const { doc, camera, snapshot } = latest.current;
      const present = new Map(snapshot.map((object) => [object.id, object]));

      if (gesture.kind === "move") {
        const delta = gestureDelta(gesture, camera);
        const positions = new Map<string, Point>();
        for (const id of gesture.ids) {
          // An object somebody else deleted mid-gesture is skipped, not resurrected.
          if (!present.has(id)) continue;
          const start = gesture.startRects.get(id);
          if (!start) continue;
          positions.set(id, { x: start.x + delta.x, y: start.y + delta.y });
        }
        if (positions.size > 0) moveObjects(doc, positions);
        return;
      }

      applyResize(gesture, present, camera, doc);
    },
    [],
  );

  const schedule = useCallback(
    (gesture: Gesture) => {
      if (gesture.frame !== null) return;
      if (typeof requestAnimationFrame !== "function") {
        applyFrame(gesture);
        return;
      }
      gesture.frame = PENDING_FRAME;
      const handle = requestAnimationFrame(() => applyFrame(gesture));
      if (gesture.frame === PENDING_FRAME) gesture.frame = handle;
    },
    [applyFrame],
  );

  const begin = useCallback(
    (gesture: Gesture) => {
      if (gesture.started) return;
      gesture.started = true;
      latest.current.onGestureStart?.();
      if (gesture.kind === "move") {
        // The whole selection is drawn above everything it overlaps (TC-06).
        bringObjectsToFront(latest.current.doc, gesture.ids);
      }
      setDraggingIds(new Set(gesture.ids));
    },
    [],
  );

  const startGesture = useCallback(
    (
      event: PointerLike,
      kind: Kind,
      ids: string[],
      handle: Handle,
      aspectLocked: boolean,
      pressId: string,
    ): Gesture | null => {
      const { snapshot } = latest.current;
      const present = new Map(snapshot.map((object) => [object.id, object]));
      const startRects = new Map<string, Rect>();
      for (const id of ids) {
        const object = present.get(id);
        if (object) startRects.set(id, objectBounds(object));
      }
      if (startRects.size === 0) return null;

      const el = elementOf(event);
      if (!el) return null;

      const gesture: Gesture = {
        kind,
        pointerId: event.pointerId,
        el,
        handle,
        aspectLocked,
        pressId,
        shiftKey: event.shiftKey,
        startX: event.clientX,
        startY: event.clientY,
        ids: Array.from(startRects.keys()),
        startRects,
        box: unionRects(Array.from(startRects.values())),
        started: false,
        ended: false,
        frame: null,
        detach: () => undefined,
      };

      const onMove = (moveEvent: Event) => {
        const pointer = moveEvent as unknown as PointerEventLike;
        const current = gestureRef.current;
        if (!current || current !== gesture) return;
        if (gesture.pointerId !== pointer.pointerId) return;
        if (typeof pointer.clientX !== "number" || typeof pointer.clientY !== "number") return;

        gestureDeltaStore.set(gesture, {
          x: pointer.clientX - gesture.startX,
          y: pointer.clientY - gesture.startY,
        });

        if (!gesture.started) {
          const moved = gestureDeltaStore.get(gesture);
          if (!moved || Math.hypot(moved.x, moved.y) < DRAG_THRESHOLD_PX) return;
          begin(gesture);
        }
        schedule(gesture);
      };

      const onUp = (upEvent: Event) => {
        const pointer = upEvent as unknown as PointerEventLike;
        if (gesture.pointerId !== pointer.pointerId) return;
        releasePointerCapture(el, pointer.pointerId);
        // Moves are applied one animation frame at a time. If the release beats
        // the frame that was queued for the last one, that frame must not be
        // thrown away: a dragged object ends where the pointer was released.
        // A *cancelled* gesture keeps the last applied position instead (TC-21).
        if (gesture.frame !== null) applyFrame(gesture);
        // Press and release without movement is a click: it selects that object
        // alone, even when the press began inside a bigger selection (which is
        // what a press *with* movement needs in order to move the group).
        if (!gesture.started && !gesture.shiftKey && gesture.pressId !== "") {
          latest.current.selection.click(gesture.pressId);
        }
        finish(gesture);
      };

      const onCancel = () => finish(gesture);
      const onLostCapture = () => finish(gesture);

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onCancel);
      el.addEventListener("lostpointercapture", onLostCapture);
      gesture.detach = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onCancel);
        el.removeEventListener("lostpointercapture", onLostCapture);
        gestureDeltaStore.delete(gesture);
      };

      gestureRef.current = gesture;
      return gesture;
    },
    [begin, finish, schedule],
  );

  const onObjectPointerDown = useCallback(
    (event: PointerLike, id: string) => {
      const { selection, canEdit } = latest.current;
      // A board that could not be loaded is not edited (TC-25).
      if (!canEdit) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // The board must neither pan nor clear the selection because an object
      // was pressed.
      event.stopPropagation();

      // Shift+press adds the object to the selection (or takes it out of it);
      // a press on an unselected object selects just that object; a press on a
      // selected one keeps the selection as it is. The ids are computed from the
      // selection as it was, because the dispatch below has not been applied yet.
      const wasSelected = selection.ids.has(id);
      const previous = Array.from(selection.ids);
      let ids: string[];
      if (event.shiftKey) {
        selection.toggle(id);
        ids = wasSelected ? previous.filter((entry) => entry !== id) : [...previous, id];
      } else {
        if (!wasSelected) selection.click(id);
        ids = wasSelected ? previous : [id];
      }

      const gesture = startGesture(event, "move", ids, "se", false, id);
      if (!gesture) return;
      capturePointer(gesture.el, event.pointerId);
    },
    [startGesture],
  );

  const onHandlePointerDown = useCallback(
    (event: PointerLike, handle: Handle) => {
      const { selection, snapshot, canEdit } = latest.current;
      if (!canEdit) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();

      const ids = Array.from(selection.ids);
      if (ids.length === 0) return;

      // No selected type can be resized: the handles were hidden anyway.
      const specs = ids
        .map((id) => snapshot.find((object) => object.id === id))
        .filter((object): object is ObjectSnapshot => object !== undefined)
        .map((object) => getObjectType(object.type));
      if (!specs.some((spec) => spec !== undefined && spec.resizable)) return;

      // Any aspect-locked type in the selection locks the whole box; Shift asks
      // for it explicitly.
      const aspectLocked = event.shiftKey || specs.some((spec) => spec?.aspectLocked === true);

      // A handle is not an object: pressing one never changes the selection.
      const gesture = startGesture(event, "resize", ids, handle, aspectLocked, "");
      if (!gesture) return;
      capturePointer(gesture.el, event.pointerId);
    },
    [startGesture],
  );

  return { onObjectPointerDown, onHandlePointerDown, draggingIds };
}

// ---- internals ------------------------------------------------------------

interface PointerEventLike {
  pointerId: number;
  clientX?: number;
  clientY?: number;
}

/** Where the pointer has moved since the gesture began, in screen pixels. */
const gestureDeltaStore = new WeakMap<Gesture, Point>();

function gestureDelta(gesture: Gesture, camera: Camera): Point {
  const delta = gestureDeltaStore.get(gesture);
  if (!delta) return { x: 0, y: 0 };
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  return { x: delta.x / zoom, y: delta.y / zoom };
}

function applyResize(
  gesture: Gesture,
  present: Map<string, ObjectSnapshot>,
  camera: Camera,
  doc: Y.Doc,
): void {
  const box = gesture.box;
  if (!box) return;

  const entries: Array<{ id: string; rect: Rect; minSize: MinSize; spec: ObjectTypeSpec; autoWidth: boolean }> = [];
  for (const id of gesture.ids) {
    const object = present.get(id);
    const start = gesture.startRects.get(id);
    if (!object || !start) continue;
    const spec = getObjectType(object.type);
    // An object whose type this client cannot render is never resized.
    if (!spec || !spec.resizable) continue;
    // A type's minimum is a floor on its **draggable** dimensions. A text object
    // has a minimum width and no minimum height at all — its height is measured
    // from its content — and giving its height a floor too would stop a whole
    // group shrinking because one short line of text is in it.
    entries.push({
      id,
      rect: start,
      minSize: spec.handles === "horizontal" ? { width: spec.minSize, height: 0 } : spec.minSize,
      spec,
      autoWidth: spec.handles === "horizontal" && object.widthMode !== "fixed",
    });
  }
  if (entries.length === 0) return;

  const target = resizeRect(box, gesture.handle, gestureDelta(gesture, camera), gesture.aspectLocked);
  const scale = clampScale(
    scaleBetween(box, target),
    entries.map((entry) => entry.rect),
    entries.map((entry) => entry.minSize),
    MAX_OBJECT_SIZE_WORLD,
  );
  // The one scale every object gets: the selection stops where its first object
  // reaches its limit, and further pointer movement changes nothing.
  const finalBox = boxForScale(box, gesture.handle, scale, gesture.aspectLocked);

  // Nothing but horizontal-handle types on a side handle is a **width drag**:
  // the type's own commit is asked for (for a text object, its width becoming
  // fixed is part of its schema) and the height that belongs to the new width is
  // measured by that type's own box sync, never dragged here. In a mixed
  // selection the generic box resize stands: every object is repositioned
  // proportionally inside the box, which scales a fixed width.
  const widthDrag =
    (gesture.handle === "e" || gesture.handle === "w") &&
    entries.every((entry) => entry.spec.handles === "horizontal");

  const rects = new Map<string, Rect>();
  const moves = new Map<string, Point>();
  for (const entry of entries) {
    const scaled = scaleWithin(entry.rect, box, finalBox);
    if (!widthDrag) {
      // An object whose width follows its content is only **repositioned** by a
      // group resize: scaling its width would fix it, which its type says must
      // not happen by dragging a box it happens to share with something else.
      // Its own box sync gives it the width its content needs at the new place.
      rects.set(
        entry.id,
        entry.autoWidth ? { x: scaled.x, y: scaled.y, width: entry.rect.width, height: entry.rect.height } : scaled,
      );
      continue;
    }
    if (entry.spec.resizeWidth) entry.spec.resizeWidth(doc, entry.id, scaled.width);
    else rects.set(entry.id, { ...scaled, height: entry.rect.height });

    // Dragging the west handle keeps the east edge still, which means the object
    // moves by exactly as much as its width shrank - including the width the type
    // clamped to its own minimum. Dragging the east handle leaves `x` alone.
    const minWidth = typeof entry.minSize === "number" ? entry.minSize : entry.minSize.width ?? 0;
    if (gesture.handle === "w") {
      const applied = Math.max(minWidth, scaled.width);
      const targetX = entry.rect.x + entry.rect.width - applied;
      const current = present.get(entry.id);
      const from = typeof current?.x === "number" ? current.x : entry.rect.x;
      const y = typeof current?.y === "number" ? current.y : entry.rect.y;
      if (targetX !== from) moves.set(entry.id, { x: targetX, y });
    }
  }
  if (rects.size > 0) resizeObjects(doc, rects);
  // Positions are corrected after the width, so the anchor is computed against
  // the width that was actually stored.
  if (moves.size > 0) moveObjects(doc, moves);
}

function elementOf(event: PointerLike): HTMLElement | null {
  const target = event.currentTarget ?? event.target;
  return target instanceof HTMLElement ? target : null;
}

function capturePointer(el: HTMLElement, pointerId: number): void {
  el.setPointerCapture?.(pointerId);
}

function releasePointerCapture(el: HTMLElement, pointerId: number): void {
  el.releasePointerCapture?.(pointerId);
}
