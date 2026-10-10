import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createShape } from '../../shared/objects/shape';
import { normalizeRect, type Rect } from '../../shared/geometry';
import {
  DRAG_THRESHOLD_PX,
  SHAPE_DEFAULT_SIZE_WORLD,
  type ShapeKind,
} from '../../shared/config';
import type { BoardSurface } from '../canvas/BoardViewport';
import { isBoardChrome, isTypingTarget, worldPointOf } from './toolPointer';

/**
 * The Shape tool's gesture (anchor `shape.tool`, `shape.size`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Preview : pointerdown with the tool armed
 *     Preview --> Preview : pointermove grows the box (Shift keeps it square)
 *     Preview --> Idle : pointerup creates one shape, selects it, tool back to Select
 *     Preview --> Idle : pointercancel creates nothing
 *     Preview --> Idle : Escape (the tool is dropped, so this gesture is dropped)
 * ```
 *
 * The listeners are on `window`, in the **capture** phase, and `stopPropagation`
 * runs on the press and on every move while the gesture is live: a shape drag that
 * started over a sticky note must not move that sticky note, pan the board or start
 * a marquee (TC-28), and the board's own handlers are below this one.
 *
 * Two boxes come out of one gesture. In **world** units: the rectangle the model is
 * given, from the anchor to the current pointer. In **screen** units: the dashed
 * preview, which is what a person is looking at while they drag and which a zoom
 * mid-drag must follow. The threshold that separates a drag from a click is
 * DRAG_THRESHOLD_PX in screen pixels - the same number story 7 uses for a drag -
 * because a press either moved or it did not, whatever the zoom is.
 */
export interface ShapeToolArgs {
  doc: Y.Doc;
  /** The tool is armed and this client may edit. */
  armed: boolean;
  shapeKind: ShapeKind;
  surface: BoardSurface | null;
  createdBy: string;
  /** The shape was created: select it and drop the tool (`tool.return`). */
  onCreated(id: string): void;
}

export interface ShapeToolGesture {
  /** The box being dragged, in world units, or null while idle. */
  readonly preview: Rect | null;
  readonly kind: ShapeKind;
}

interface LiveGesture {
  pointerId: number;
  /** Where the press landed, in world units: the click point, or the drag corner. */
  anchor: { x: number; y: number };
  /** The same press in screen units, which is what the drag threshold measures. */
  startClient: { x: number; y: number };
  rect: Rect;
  /** Shift held: both sides take the larger dimension (`shape.size`). */
  square: boolean;
  /** Past `DRAG_THRESHOLD_PX` yet? The same rule story 7's drag uses. */
  moved: boolean;
}

const defaultBox = (at: { x: number; y: number }): Rect => ({
  x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
  y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
  width: SHAPE_DEFAULT_SIZE_WORLD,
  height: SHAPE_DEFAULT_SIZE_WORLD,
});

/** The box a drag has made, from the corner it started at to the pointer. */
function draggedRect(
  gesture: LiveGesture,
  current: { x: number; y: number },
  square: boolean,
): Rect {
  const dx = current.x - gesture.anchor.x;
  const dy = current.y - gesture.anchor.y;
  if (square) {
    // The corner the drag started from is the corner that stays: the box grows
    // away from it, left-and-up if the pointer went left-and-up (TC-04).
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: dx >= 0 ? gesture.anchor.x : gesture.anchor.x - side,
      y: dy >= 0 ? gesture.anchor.y : gesture.anchor.y - side,
      width: side,
      height: side,
    };
  }
  return normalizeRect(gesture.anchor, current);
}

export function useShapeTool(args: ShapeToolArgs): ShapeToolGesture {
  const [preview, setPreview] = useState<Rect | null>(null);
  const gestureRef = useRef<LiveGesture | null>(null);

  // The camera, the document and the callback are read through a ref so a live
  // gesture is never interrupted by a re-render - the pattern every board gesture
  // in this app uses.
  const inputs = useRef(args);
  inputs.current = args;

  const listening = args.armed;

  useEffect(() => {
    if (!listening) {
      // Dropping the tool drops the gesture in progress: nothing is created, and
      // the preview goes away (`shape.tool`, TC-22).
      gestureRef.current = null;
      setPreview(null);
      return undefined;
    }

    const finish = (create: boolean): void => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      setPreview(null);
      if (!gesture || !create) {
        return;
      }
      const current = inputs.current;
      // A press that never left the click hands the model `rect: null` and the
      // click point, and the model centres the default box on it (TC-02).
      const id = createShape(
        current.doc,
        {
          kind: current.shapeKind,
          rect: gesture.moved ? gesture.rect : null,
          at: gesture.anchor,
          square: gesture.square,
        },
        current.createdBy,
      );
      if (id !== null) {
        current.onCreated(id);
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || gestureRef.current !== null) {
        return;
      }
      if (isBoardChrome(event.target) || isTypingTarget(event.target)) {
        return; // the toolbar and an open editor are not a shape waiting to happen
      }
      const anchor = worldPointOf(event, inputs.current.surface);
      if (!anchor) {
        return;
      }
      event.stopPropagation();
      gestureRef.current = {
        pointerId: event.pointerId,
        anchor,
        startClient: { x: event.clientX, y: event.clientY },
        // What a tap would make, shown at once: the default box, centred here.
        rect: defaultBox(anchor),
        square: event.shiftKey,
        moved: false,
      };
      setPreview(gestureRef.current.rect);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      const current = worldPointOf(event, inputs.current.surface);
      if (!current) {
        return;
      }
      event.stopPropagation();
      // Shift is read on every move, so holding it partway through a drag still
      // constrains the box (`shape.size`).
      gesture.square = event.shiftKey;
      if (
        !gesture.moved &&
        Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) <
          DRAG_THRESHOLD_PX
      ) {
        return; // still a possible click: the preview stays the box a tap makes
      }
      gesture.moved = true;
      gesture.rect = draggedRect(gesture, current, gesture.square);
      setPreview(gesture.rect);
    };

    const onPointerUp = (event: PointerEvent): void => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }
      event.stopPropagation();
      const current = worldPointOf(event, inputs.current.surface);
      if (current) {
        gesture.rect = draggedRect(gesture, current, gesture.square);
      }
      finish(true);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      if (gestureRef.current?.pointerId !== event.pointerId) {
        return;
      }
      finish(false); // nothing was created (`shape.tool`)
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      gestureRef.current = null;
      setPreview(null);
    };
  }, [listening]);

  return { preview, kind: args.shapeKind };
}
