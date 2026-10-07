import { useCallback, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import * as Y from 'yjs';

import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config.js';
import { createShape } from '../../shared/objects/shape.js';
import type { Rect } from '../../shared/board-model.js';
import { screenToWorld, type Camera, type Point } from '../canvas/camera.js';
import type { UndoController } from '../board/undo.js';

/**
 * The Shape tool (`src/client/tools/ShapeTool.tsx`) - the shape is the first thing
 * on the board that has to be *drawn* rather than clicked into place, so this tool
 * is where the board learns about dragging: press, watch a dashed outline grow, let
 * go, and the shape is there.
 *
 * It is a screen-space layer over the board rather than a change to it: while it is
 * up it owns every pointer event on the board area, which is what makes
 * `shape.no_move_other` true for free. A drag that starts on top of somebody's note
 * never reaches the note, so it can never move the note; the note is only ever what
 * the new shape lands on. That is also why the preview is drawn in screen pixels -
 * the board underneath is not asked to show anything.
 *
 * The drag lives in a ref and the preview in state. That is not decoration: the
 * release is a side effect - it writes the document - and a React state updater may
 * be called more than once for the same event, which would draw two shapes.
 */

/** Only this pointer button draws. */
const PRIMARY_BUTTON = 0;

/** The drag, in screen pixels, as the pointer describes it. */
interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shift: boolean;
  moved: boolean;
}

export interface ShapeToolProps {
  doc: Y.Doc;
  /** The shape this tool draws (the toolbar's popup decides it). */
  kind: ShapeKind;
  camera: Camera;
  /** This tab's undo history, so one drawn shape is one Ctrl+Z. */
  undo?: UndoController;
  /** Whose id is written on the shape as its creator; nobody in this build has a name. */
  identityId?: string;
  /** A shape was drawn: select it and go back to Select (`tools.return_to_select`). */
  onCreated(id: string): void;
}

/** The drag as a rectangle in screen pixels, square when Shift held it square. */
export function dragRect(drag: Drag): Rect {
  let dx = drag.x1 - drag.x0;
  let dy = drag.y1 - drag.y0;
  if (drag.shift) {
    // A square is the bigger of the two sides, pushed out in the directions the
    // pointer actually travelled - which is what the model is told with `square`.
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return {
    x: Math.min(drag.x0, drag.x0 + dx),
    y: Math.min(drag.y0, drag.y0 + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/** A screen-pixel rectangle into board units. */
export function screenToWorldRect(camera: Camera, rect: Rect): Rect {
  const start = screenToWorld(camera, { x: rect.x, y: rect.y });
  const end = screenToWorld(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
}

export function ShapeTool({ doc, kind, camera, undo, identityId = '', onCreated }: ShapeToolProps): JSX.Element {
  const [preview, setPreview] = useState<Rect | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  /** Screen pixels relative to the board area. */
  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== PRIMARY_BUTTON) return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const point = local(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      x0: point.x,
      y0: point.y,
      x1: point.x,
      y1: point.y,
      shift: event.shiftKey,
      moved: false,
    };
    setPreview(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    const point = local(event);
    drag.x1 = point.x;
    drag.y1 = point.y;
    drag.shift = event.shiftKey;
    if (
      !drag.moved &&
      (point.x - drag.x0) ** 2 + (point.y - drag.y0) ** 2 >=
        DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
    ) {
      drag.moved = true;
    }
    setPreview(drag.moved ? dragRect(drag) : null);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPreview(null);
    if (drag === null) return;
    const point = local(event);
    const cam = cameraRef.current;
    const finished = { ...drag, x1: point.x, y1: point.y, shift: event.shiftKey };
    undo?.boundary();
    // A press that never travelled asks for a shape of the default size centred on
    // the pointer; a drag asks for the outline it described.
    const id = finished.moved
      ? createShape(
          doc,
          {
            kind: kindRef.current,
            rect: screenToWorldRect(cam, dragRect(finished)),
            at: screenToWorld(cam, { x: finished.x0, y: finished.y0 }),
            square: finished.shift,
          },
          identityId,
        )
      : createShape(
          doc,
          { kind: kindRef.current, rect: null, at: screenToWorld(cam, { x: finished.x0, y: finished.y0 }) },
          identityId,
        );
    undo?.boundary();
    // A rejection creates nothing, and the tool stays exactly where it was: the
    // person is still holding the shape they wanted.
    if (typeof id === 'string') onCreatedRef.current(id);
  };

  /** A cancelled gesture draws nothing at all. */
  const handlePointerCancel = () => {
    dragRef.current = null;
    setPreview(null);
  };

  return (
    <div
      ref={surfaceRef}
      className="tool-surface"
      data-testid="shape-tool-surface"
      data-tool="shape"
      data-kind={kind}
      role="presentation"
      aria-label={`Drawing a ${kind} shape`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview !== null ? (
        <div
          className="shape-preview"
          data-testid="shape-preview"
          data-kind={kind}
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

export default ShapeTool;
