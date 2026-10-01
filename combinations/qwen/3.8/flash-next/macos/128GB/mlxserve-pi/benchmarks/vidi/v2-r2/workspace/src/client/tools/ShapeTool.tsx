// The Shape tool (story 10): press, drag, let go, and a shape is drawn.
//
// It is the Text tool's sibling in every way that matters - a layer over the whole
// board, above every object, screen-sized, that takes the next press whatever it
// lands on. That is what makes "a drag that starts on a sticky note moves nothing":
// the press is captured to this layer, and the note under the pointer never hears
// about it. The pointer may leave the board mid-drag and come back.
//
// The preview is drawn from `shapeRectOf` - the same maths `createShape` stores -
// so the dashed box is the box: click size, dragged box or Shift square, clamped
// the way the model clamps, read on every move rather than only at the end.
//
// Nothing is stored until the pointer comes up, and a drag let go of by the system
// draws no shape at all, the way a marquee drawn and then cancelled selects nothing.

import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { shapeRectOf } from '../../shared/objects/shape';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { useBoardCamera } from '../canvas/CameraProvider';
import type { CameraApi } from '../canvas/useCamera';

/** What a finished shape drag asks the board to draw. */
export interface ShapeCreateSpec {
  kind: ShapeKind;
  /** The dragged box in board units, or null for a click, which drops a default. */
  rect: Rect | null;
  /** The point the press began at - where a click's shape is centred. */
  at: Point;
  /** Shift held during the drag: one side, the longer of the two. */
  square: boolean;
}

export interface ShapeToolProps {
  /** The kind the next shape is drawn as, from the Shape menu. */
  kind: ShapeKind;
  /** A board that could not be read draws no shapes: the layer takes no presses. */
  canCreate: boolean;
  /**
   * Draw it. The board owns the document, the undo window and the selection, so the
   * tool asks for a shape rather than writing one - and hears nothing back: a shape
   * the model refused to draw is a shape that is not on the board, which is all the
   * tool can be told and all it needs to know.
   */
  onCreate(spec: ShapeCreateSpec): void;
}

/** The press that may still turn into a shape. */
interface ShapePress {
  pointerId: number;
  /** Where the press began, on screen and on the board. */
  screenX: number;
  screenY: number;
  world: Point;
  /** Shift, read on every event rather than only at the press. */
  square: boolean;
  moved: boolean;
  /** Where the pointer last was, board units. */
  x: number;
  y: number;
}

export function ShapeTool({ kind, canCreate, onCreate }: ShapeToolProps): JSX.Element {
  const { camera } = useBoardCamera();
  const press = useRef<ShapePress | null>(null);
  /** The box the model would store, in board units; null while nothing is dragged. */
  const [preview, setPreview] = useState<Rect | null>(null);

  const pointOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  /** The box this press would store if the pointer came up here. */
  const boxOf = (current: ShapePress): Rect | null =>
    shapeRectOf({
      rect: current.moved ? normalizeRect(current.world, { x: current.x, y: current.y }) : null,
      at: current.world,
      square: current.square,
    });

  const finish = (): void => {
    press.current = null;
    setPreview(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Nothing behind this layer sees the press: no pan, no marquee, and above all
    // no grab of the object the press happens to have begun on.
    event.stopPropagation();
    if (!canCreate) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const world = pointOf(event);
    press.current = {
      pointerId: event.pointerId,
      screenX: event.clientX,
      screenY: event.clientY,
      world,
      square: event.shiftKey,
      moved: false,
      x: world.x,
      y: world.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    current.square = event.shiftKey;
    // under a few pixels the pointer is still a click, which makes a standard shape
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.screenX, event.clientY - current.screenY) < DRAG_THRESHOLD_PX) {
        return;
      }
      current.moved = true;
    }
    const world = pointOf(event);
    current.x = world.x;
    current.y = world.y;
    setPreview(boxOf(current));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    const world = pointOf(event);
    current.x = world.x;
    current.y = world.y;
    finish();
    onCreate({
      kind,
      rect: current.moved ? normalizeRect(current.world, world) : null,
      at: current.world,
      square: current.square,
    });
  };

  // A drag cut short by the system draws no shape.
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (press.current === null || event.pointerId !== press.current.pointerId) return;
    event.stopPropagation();
    finish();
  };

  return (
    <div
      className="shape-tool-layer"
      data-testid="shape-tool-layer"
      data-kind={kind}
      data-can-create={canCreate}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      // a double-click belongs to the tool that is held, not to the board's rule
      // that a double-click on the board makes a note
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview === null ? null : (
        <div
          className={`shape-preview shape-preview--${kind}`}
          data-testid="shape-preview"
          data-preview-kind={kind}
          data-preview-square={String(preview.width === preview.height)}
          style={screenBox(camera, preview)}
        />
      )}
    </div>
  );
}

/**
 * A box in board units, placed on the screen: the layer is not scaled, so the
 * preview is positioned in screen pixels and drawn at whatever size the camera says.
 */
function screenBox(camera: CameraApi['camera'], rect: Rect): CSSProperties {
  const a = worldToScreen(camera, { x: rect.x, y: rect.y });
  const b = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    left: `${Math.min(a.x, b.x)}px`,
    top: `${Math.min(a.y, b.y)}px`,
    width: `${Math.abs(b.x - a.x)}px`,
    height: `${Math.abs(b.y - a.y)}px`,
  };
}
