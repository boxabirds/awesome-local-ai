import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  moveObjects,
  resizeObjects,
  bringObjectsToFront,
  objectBounds,
} from '../../shared/board-model';
import { clampTextWidth, setTextWidthFixed } from '../../shared/objects/text';
import { setConnectorFreeEnds } from '../../shared/objects/connector';
import { createCanvasMeasurer, type Measurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import type { SelectionApi } from './useSelection';
import type { Rect, Handle } from '../../shared/geometry';
import { unionRects, resizeRect, clampScale, scaleWithin } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, MAX_OBJECT_SIZE_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface TransformGestureOptions {
  doc: Y.Doc;
  camera: Camera;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** The gesture is about to write its first change (once the drag passes the
   * threshold, and never for a click). Story 8 opens an undo step here.
   */
  onGestureStart?(): void;
  /** The gesture wrote something and is over (released or cancelled — both end
   * it the same way, so a cancelled drag is exactly one undo step).
   */
  onGestureEnd?(): void;
}

export interface TransformGestureResult {
  /** Called when pointerdown lands on an object. */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  /** Called when pointerdown lands on a resize handle. */
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /** Forward pointermove from the captured element. */
  onPointerMove(e: ReactPointerEvent): void;
  /** Forward pointerup from the captured element. */
  onPointerUp(e: ReactPointerEvent): void;
  /** Forward pointercancel from the captured element. */
  onPointerCancel(e: ReactPointerEvent): void;
}

interface GestureState {
  type: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  /** Starting rects of all selected objects. */
  startRects: Map<string, Rect>;
  /** Starting bounding rect for resize. */
  boundingBox?: Rect;
  /** Starting scale for aspect ratio (resize only). */
  startRatio?: number;
  /** Handle for resize. */
  handle?: Handle;
  /** Whether aspect is locked. */
  aspectLocked?: boolean;
  /** Per-object min sizes. */
  minSizes?: Map<string, number>;
  /** Which of the objects being resized are free text, by id. */
  texts?: Set<string>;
  /** Which of them have a width of their own, rather than one the text decided. */
  fixed?: Set<string>;
  /** Where the arrow ends were when the drag took hold, by id: an arrow is dragged
   * by its free ends, and a drag says where the pointer has got to, so the ends are
   * written where they have got to rather than by however much they have gone.
   * Attached ends are not in it, because they are not the arrow's to move. */
  ends?: Map<string, { from: Point; to: Point }>;
  /** Whether threshold has been crossed. */
  moved: boolean;
  /** The element that has pointer capture. */
  element: Element;
}

/**
 * Generic transform gesture: group move and bounding-box resize handles.
 *
 * Move: records start rects of all selected objects, then on each pointermove
 * applies absolute positions (start + delta/zoom).
 *
 * Resize: uses resizeRect on the bounding box, clamps scale via clampScale,
 * then scaleWithin per object.
 */
export function useTransformGesture(opts: TransformGestureOptions): TransformGestureResult {
  const gestureRef = useRef<GestureState | null>(null);
  const rafRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // One measurer for the board, for the times a resize changes a text object's
  // width and so the number of lines its text needs.
  const measureRef = useRef<Measurer | null>(null);
  if (measureRef.current === null) measureRef.current = createCanvasMeasurer();

  const applyMove = useCallback(() => {
    const gesture = gestureRef.current;
    const pending = pendingRef.current;
    if (gesture === null || pending === null) return;

    const o = optsRef.current;
    if (!o.canEdit) return;

    const dx = (pending.x - gesture.startX) / o.camera.zoom;
    const dy = (pending.y - gesture.startY) / o.camera.zoom;

    if (gesture.type === 'move') {
      const positions = new Map<string, Point>();
      for (const [id, rect] of gesture.startRects) {
        positions.set(id, { x: rect.x + dx, y: rect.y + dy });
      }
      moveObjects(o.doc, positions);
      // An arrow in the same drag goes with it, at the only resolution at which an
      // arrow can be asked to move: where its free ends are. Both counts are one
      // transaction each, inside the one undo window this drag opened.
      if (gesture.ends !== undefined && gesture.ends.size > 0) {
        const moved = new Map<string, { from: Point; to: Point }>();
        for (const [id, ends] of gesture.ends) {
          moved.set(id, { from: { x: ends.from.x + dx, y: ends.from.y + dy }, to: { x: ends.to.x + dx, y: ends.to.y + dy } });
        }
        setConnectorFreeEnds(o.doc, moved);
      }
    } else if (gesture.type === 'resize' && gesture.boundingBox && gesture.handle) {
      // Resize the bounding box
      const delta = { x: dx, y: dy };
      const newBox = resizeRect(gesture.boundingBox, gesture.handle, delta, gesture.aspectLocked ?? false);

      // Clamp scale
      const rects: Rect[] = [];
      const minSizes: number[] = [];
      const ids: string[] = [];
      for (const [id, rect] of gesture.startRects) {
        rects.push(rect);
        ids.push(id);
        const minSize = gesture.minSizes?.get(id) ?? 0;
        minSizes.push(minSize);
      }

      const proposedScaleX = gesture.boundingBox.width === 0 ? 1 : newBox.width / gesture.boundingBox.width;
      const proposedScaleY = gesture.boundingBox.height === 0 ? 1 : newBox.height / gesture.boundingBox.height;
      const clampedScale = clampScale(
        { x: proposedScaleX, y: proposedScaleY },
        rects,
        minSizes,
        MAX_OBJECT_SIZE_WORLD,
      );

      // Apply uniform clamped scale to bounding box
      const scaledBox: Rect = {
        x: gesture.boundingBox.x,
        y: gesture.boundingBox.y,
        width: gesture.boundingBox.width * clampedScale.x,
        height: gesture.boundingBox.height * clampedScale.y,
      };

      // For handles that move the origin, adjust position
      if (gesture.handle === 'w' || gesture.handle === 'nw' || gesture.handle === 'sw') {
        scaledBox.x = gesture.boundingBox.x + gesture.boundingBox.width - scaledBox.width;
      }
      if (gesture.handle === 'n' || gesture.handle === 'nw' || gesture.handle === 'ne') {
        scaledBox.y = gesture.boundingBox.y + gesture.boundingBox.height - scaledBox.height;
      }

      // Scale each object within the box
      const only = gesture.startRects.size === 1 ? [...gesture.startRects.keys()][0] : undefined;
      if (only !== undefined && gesture.texts?.has(only) === true) {
        // One text object on its own: a side handle decides how wide its box is,
        // and its height is however many lines the text needs inside that width.
        // There is no other resize for it — the overlay gives a text object two
        // handles and no more, because its height is its text's business — so it
        // does not take the group's uniform scale, which would scale its letters
        // instead of its line length. The width is the pointer's distance, and
        // the model's clamp, and nothing else.
        if (gesture.handle !== 'w' && gesture.handle !== 'e') return;
        const start = gesture.startRects.get(only);
        if (start === undefined) return;
        const width = clampTextWidth(
          gesture.handle === 'e' ? start.width + dx : start.width - dx,
        );
        setTextWidthFixed(o.doc, only, width);
        remeasureTextBox(o.doc, only, measureRef.current as Measurer);
        if (gesture.handle === 'w') {
          // A left handle travels with the width it gives: the edge the person is
          // not holding, the right one, is the edge that stays where it was.
          moveObjects(o.doc, new Map([[only, { x: start.x + start.width - width, y: start.y }]]));
        }
        return;
      }

      const newRects = new Map<string, Rect>();
      for (const [id, startRect] of gesture.startRects) {
        const scaled = scaleWithin(startRect, gesture.boundingBox, scaledBox);
        if (gesture.texts?.has(id) !== true || gesture.fixed?.has(id) === true) {
          newRects.set(id, scaled);
          continue;
        }
        // A text object whose width the text decided keeps that width: inside a
        // group, only its place belongs to the group. Its font never scales — no
        // text object's font does — so scaling the box repositions it and nothing
        // else. When the drag is over its lines are counted again.
        newRects.set(id, { x: scaled.x, y: scaled.y, width: startRect.width, height: startRect.height });
      }
      resizeObjects(o.doc, newRects);
      if (gesture.fixed !== undefined) {
        for (const id of gesture.fixed) remeasureTextBox(o.doc, id, measureRef.current as Measurer);
      }
    }
  }, []);

  const scheduleApply = useCallback(() => {
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      applyMove();
    });
  }, [applyMove]);

  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture === null) return;

    // Apply any pending position immediately
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    applyMove();

    const o = optsRef.current;
    // Try to release pointer capture
    try {
      gesture.element.releasePointerCapture(gesture.pointerId);
    } catch {
      /* already released */
    }

    gestureRef.current = null;
    pendingRef.current = null;

    if (gesture.moved && o.onGestureEnd) o.onGestureEnd();
  }, [applyMove]);

  const onObjectPointerDown = useCallback((e: ReactPointerEvent, id: string) => {
    const o = optsRef.current;

    // If the id is not selected, select only it first.
    if (!o.selection.ids.has(id)) {
      o.selection.click(id);
    }

    // We need the selection AFTER the click, but the dispatch hasn't flushed yet.
    // For the gesture, use either just [id] or the current selection (if already selected).
    const idsToMove = o.selection.ids.has(id)
      ? [...o.selection.ids]
      : [id];

    // Record start rects of all objects to move
    const startRects = new Map<string, Rect>();
    const ends = new Map<string, { from: Point; to: Point }>();
    for (const oid of idsToMove) {
      const obj = o.snapshot.find((s) => s.id === oid);
      if (obj === undefined) continue;
      startRects.set(oid, objectBounds(obj));
      // An arrow's ends, as they are drawn right now: the drag below moves the free
      // ones by this drag's distance and leaves the fastened ones to their shapes.
      if (obj.type === 'connector') ends.set(oid, { from: obj.resolved.from, to: obj.resolved.to });
    }

    gestureRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      ends,
      moved: false,
      element: e.currentTarget as Element,
    };
    pendingRef.current = null;

    // Capture pointer
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  }, []);

  const onHandlePointerDown = useCallback((e: ReactPointerEvent, handle: Handle) => {
    const o = optsRef.current;
    if (!o.canEdit) return;

    // Check if any selected type is resizable
    let anyResizable = false;
    let anyAspectLocked = false;
    const startRects = new Map<string, Rect>();
    const minSizes = new Map<string, number>();
    const texts = new Set<string>();
    const fixed = new Set<string>();

    for (const id of o.selection.ids) {
      const obj = o.snapshot.find((s) => s.id === id);
      if (obj === undefined) continue;
      const spec = getObjectType(obj.type);
      if (spec === undefined) continue;
      if (spec.resizable) anyResizable = true;
      if (spec.aspectLocked) anyAspectLocked = true;
      startRects.set(id, objectBounds(obj));
      minSizes.set(id, spec.minSize);
      if (obj.type === 'text') {
        texts.add(id);
        if (obj.widthMode === 'fixed') fixed.add(id);
      }
    }

    if (!anyResizable) return;

    const boundingBox = unionRects([...startRects.values()]);
    if (boundingBox === null) return;

    // Aspect locked when any spec is aspectLocked or Shift is held
    const aspectLocked = anyAspectLocked || e.shiftKey;

    gestureRef.current = {
      type: 'resize',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      boundingBox,
      handle,
      aspectLocked,
      minSizes,
      texts,
      fixed,
      moved: false,
      element: e.currentTarget as Element,
    };
    pendingRef.current = null;

    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  }, []);

  // Pointer move handler (attached by the consumer via the returned object,
  // or we provide handlers for the overlay to use)
  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (gesture === null || e.pointerId !== gesture.pointerId) return;

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      gesture.moved = true;
      const o = optsRef.current;
      // The gesture's own undo window is opened before the first thing the
      // gesture writes — including bringing the note to the front, which is part
      // of this drag and not a step of its own. Everything this drag then writes
      // falls inside the one capture window, so one press of Undo returns the
      // whole drag (story 8).
      if (o.onGestureStart) o.onGestureStart();
      // Bring to front on move start
      if (gesture.type === 'move' && o.canEdit) {
        bringObjectsToFront(o.doc, [...gesture.startRects.keys()]);
      }
    }

    pendingRef.current = { x: e.clientX, y: e.clientY };
    scheduleApply();
  }, [scheduleApply]);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (gesture === null || e.pointerId !== gesture.pointerId) return;
    endGesture();
  }, [endGesture]);

  const onPointerCancel = useCallback((e: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (gesture === null || e.pointerId !== gesture.pointerId) return;
    endGesture();
  }, [endGesture]);

  return { onObjectPointerDown, onHandlePointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
