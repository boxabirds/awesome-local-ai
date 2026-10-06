import { useCallback, useRef, useState } from "react";
import type * as Y from "yjs";
import { createShape } from "../../shared/objects/shape";
import { SHAPE_MIN_SIZE_WORLD, type FillColor, type ShapeKind, type StrokeColor } from "../../shared/config";
import type { Rect } from "../../shared/geometry";
import type { Camera, Point } from "../canvas/camera";
import { screenToWorld } from "../canvas/camera";
import { DRAG_THRESHOLD_PX } from "../../shared/config";
import { dragRectWorld, previewScreenRect } from "../canvas/shapeGeometry";
import { isBoardControl, useCaptureGestures } from "./useCaptureGestures";

/**
 * The Shape tool (`shape.ui`, story 10).
 *
 * While this tool is active it owns the board's pointer: a press anywhere on the
 * board draws a shape, including a press on top of an existing object — which is
 * what keeps a Shape-tool drag from moving the thing it started on
 * (`shape.over_object`, TC-28). A press on a control (a toolbar button, a label
 * being typed into) belongs to that control.
 *
 * What a release creates is the model's decision, not this component's: a drag
 * becomes that rectangle, a click — or a drag too small to be a shape — becomes a
 * standard shape centred on the point, and Shift makes it a square. The dashed
 * preview is drawn from the same arithmetic, so what a person sees is what
 * appears.
 */

export interface ShapeToolProps {
  doc: Y.Doc;
  /** The kind the next shape is drawn as. */
  kind: ShapeKind;
  /** The style subsequently created shapes start with. */
  fill: FillColor;
  stroke: StrokeColor;
  camera: Camera;
  /** False when this board could not be loaded: the tool draws nothing. */
  canEdit: boolean;
  /** Ends the current undo step, so the created shape is one step of its own. */
  onGestureBoundary?(): void;
  /** The created shape is selected and the board is back in Select. */
  onCreated(id: string): void;
}

interface Press {
  pointerId: number;
  start: Point;
  moved: boolean;
  /** Shift was held at some point during this press. */
  shift: boolean;
}

export function ShapeTool({ doc, kind, fill, stroke, camera, canEdit, onGestureBoundary, onCreated }: ShapeToolProps) {
  const [preview, setPreview] = useState<Rect | null>(null);

  // Latest values: the release must use the camera, the kind and the style the
  // board has at that moment, not the ones it had when the press began.
  const latest = useRef({ doc, kind, fill, stroke, camera, canEdit, onGestureBoundary, onCreated });
  latest.current = { doc, kind, fill, stroke, camera, canEdit, onGestureBoundary, onCreated };

  const pressRef = useRef<Press | null>(null);

  const finish = useCallback((event: PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    setPreview(null);
    if (press === null) return;

    const { doc: document, kind: shapeKind, fill: shapeFill, stroke: shapeStroke, camera: cam, onGestureBoundary: boundary, onCreated: created } =
      latest.current;

    const square = event.shiftKey || press.shift;
    const origin = screenToWorld(cam, press.start);
    const rect = press.moved ? dragRectWorld(cam, press.start, { x: event.clientX, y: event.clientY }) : null;

    // A drag too small to be a shape is a click: `createShape` centres the
    // standard size on the point it is given.
    const args = rect === null || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD
      ? {
          kind: shapeKind,
          rect: null,
          at: press.moved ? screenToWorld(cam, { x: event.clientX, y: event.clientY }) : origin,
          square,
          fill: shapeFill,
          stroke: shapeStroke,
        }
      : { kind: shapeKind, rect, at: origin, square, fill: shapeFill, stroke: shapeStroke };

    boundary?.();
    const id = createShape(document, args);
    boundary?.();
    if (typeof id === "string") created(id);
  }, []);

  useCaptureGestures(canEdit, {
    onPointerDown: (event, point) => {
      if (isBoardControl(event.target)) return false;
      pressRef.current = { pointerId: event.pointerId, start: point, moved: false, shift: event.shiftKey };
      return true;
    },
    onPointerMove: (event, point) => {
      const press = pressRef.current;
      if (press === null) return;
      if (event.shiftKey) press.shift = true;
      if (!press.moved && Math.hypot(point.x - press.start.x, point.y - press.start.y) < DRAG_THRESHOLD_PX) return;
      press.moved = true;
      setPreview(previewScreenRect(press.start, point, press.shift));
    },
    onPointerUp: (event) => finish(event),
    onPointerCancel: () => {
      // A cancelled gesture creates nothing.
      pressRef.current = null;
      setPreview(null);
    },
  });

  if (preview === null) return null;
  return (
    <div
      className="shape-preview"
      data-testid="shape-preview"
      aria-hidden="true"
      style={{ left: `${preview.x}px`, top: `${preview.y}px`, width: `${preview.width}px`, height: `${preview.height}px` }}
    />
  );
}
