import {
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { createShape, shapeRectFor, type ShapeKind } from '../../shared/objects/shape';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';

/**
 * The Shape tool's surface (`shape.ui`): the layer that sits over the board while the Shape
 * tool is up, draws the box being dragged, and puts one shape down where the drag ended.
 *
 * Two things it does are worth stating plainly, because they are the two the tests push on:
 *
 * - It *is* the pointer capture. Nothing below it gets a press, so a drag that starts on top
 *   of a sticky note draws a shape instead of moving the note (TC-28, design: the tool
 *   captures the pointer). The layer covers the viewport and takes every press in it.
 * - It creates exactly one shape, on the release. A press that is cancelled creates nothing,
 *   and a tool that is taken away in the middle of a drag (Escape, which puts Select back)
 *   creates nothing either, because the drag lives in this component's state.
 *
 * The box the user sees is the box they get: `shapeRectFor` — the model's own answer to "what
 * shape does this drag make" — is asked while the drag is still going on, so the preview shows
 * the standard-size click case and the Shift square exactly as they will be written.
 */
export interface ShapeToolProps {
  /** Which of the three kinds the next shape is. */
  kind: ShapeKind;
  /** The camera, for turning the pointer into board units. */
  camera: Camera;
  doc: Y.Doc;
  /** The device drawing, stored as the shape's `createdBy` (story 6). */
  createdBy: string;
  /** The shape is on the board: it becomes the selection and the tool goes back to Select. */
  onCreated(id: string): void;
}

/** A drag in progress, in screen pixels — the space the pointer is in. */
interface Drag {
  readonly from: Point;
  to: Point;
  square: boolean;
}

export function ShapeTool({ kind, camera, doc, createdBy, onCreated }: ShapeToolProps): JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The camera and the callback are read when the pointer is released, which may be a long
  // time — and several board moves — after the render that started the drag.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const undo = useUndoController();
  // One pointer is enough: the first press wins and keeps the drag until it is released.
  const pointerIdRef = useRef<number | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The press belongs to the tool, and nothing under it hears about it.
    event.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') element.setPointerCapture(event.pointerId);
    const at = screenPoint(event);
    setDrag({ from: at, to: at, square: event.shiftKey });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    const at = screenPoint(event);
    // Shift is read on every move, so letting go of it mid-drag changes the shape the preview
    // shows and the shape that gets written (design: shape.constrain).
    setDrag((current) => (current ? { ...current, to: at, square: event.shiftKey } : current));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.stopPropagation();
    const current = drag;
    setDrag(null);
    if (!current) return;
    const at = screenPoint(event);
    const cam = cameraRef.current;
    const from = screenToWorld(cam, current.from);
    const to = screenToWorld(cam, at);
    // A drag can go left or up; the box is the box, whichever way it was drawn.
    const dragged = {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
    // One shape is one undo step, whatever the drag did on the way (`stopCapturing`).
    undo?.boundary();
    const id = createShape(doc, { kind, rect: dragged, at: from, square: current.square }, createdBy);
    undo?.boundary();
    // A rejected shape (a kind that is not one of the three, a point that is not a point)
    // leaves the tool up and the board alone.
    if (id === null) return;
    onCreatedRef.current(id);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    // Thrown away, like a marquee: the shape is never written (design: pointercancel).
    pointerIdRef.current = null;
    event.stopPropagation();
    setDrag(null);
  };

  /** The dragged box in screen pixels, already resolved the way the model will resolve it. */
  let preview: { x: number; y: number; width: number; height: number } | null = null;
  if (drag) {
    const cam = cameraRef.current;
    const from = screenToWorld(cam, drag.from);
    const to = screenToWorld(cam, drag.to);
    const dragged = {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
    const box = shapeRectFor({ rect: dragged, at: from, square: drag.square });
    if (box) {
      const topLeft = worldToScreen(cam, { x: box.x, y: box.y });
      const bottomRight = worldToScreen(cam, { x: box.x + box.width, y: box.y + box.height });
      preview = {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y),
      };
    }
  }

  return (
    <div
      className="vidi6-shape-tool-surface"
      data-testid="shape-tool-surface"
      data-shape-kind={kind}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={stop}
    >
      {preview ? (
        <div
          className="vidi6-shape-preview"
          data-testid="shape-preview"
          data-preview-width={Math.round(preview.width)}
          data-preview-height={Math.round(preview.height)}
          style={{
            left: `${preview.x}px`,
            top: `${preview.y}px`,
            width: `${preview.width}px`,
            height: `${preview.height}px`,
          }}
        />
      ) : null}
    </div>
  );
}

function stop(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

/** The pointer, in pixels inside the viewport, which is what the camera works in. */
function screenPoint(event: {
  currentTarget: EventTarget | null;
  clientX: number;
  clientY: number;
}): Point {
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
