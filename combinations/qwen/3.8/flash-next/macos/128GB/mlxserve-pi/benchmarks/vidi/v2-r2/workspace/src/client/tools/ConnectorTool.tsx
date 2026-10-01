// The Connector tool (story 10): press on a shape, drag, let go somewhere else, and
// an arrow is drawn between them.
//
// Like the Shape tool it is a screen-sized layer over the whole board, above every
// object, so the press is the tool's whatever it began on and no object under the
// pointer is grabbed. On top of that it answers one question continuously: *what
// would each end become if the pointer came up here?* - and says so in the only way
// an end can be said: the four side dots of the object under the pointer, with the
// one that would take the arrow drawn as the target.
//
// Which side an end is drawn on is not this file's guess: `endpointAtDrop` says it,
// the same way `createConnector` and every later render say it. So the dot that is
// highlighted while you hover is the side the arrow will be drawn at once it is
// stored - and a release that changes nothing writes nothing.
//
// The two things that stop an arrow being drawn by accident live here, because they
// are about a gesture rather than about a document: releasing on the object the
// press started on, and a pointer that travelled less than CONNECTOR_MIN_LENGTH_WORLD.
// The model refuses an arrow between two ends on the same object too; a gesture that
// would ask for one never gets that far.

import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import type { CameraApi } from '../canvas/useCamera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { useBoardCamera } from '../canvas/CameraProvider';
import {
  attachTarget,
  endpointAtDrop,
  type Attachable,
  type Endpoint,
} from '../../shared/objects/connector';
import {
  centre,
  nearestSide,
  sideAnchor,
  SIDES,
  type Side,
} from '../../shared/geometry/connector-geometry';
import type { Point } from '../../shared/geometry';

/** What a finished arrow drag asks the board to draw. */
export interface ConnectorCreateSpec {
  from: Endpoint;
  to: Endpoint;
}

export interface ConnectorToolProps {
  /** The board the ends are dropped onto: which object a point lands on is a
   * question about the document, and only the document can answer it. */
  doc: Y.Doc;
  /** A board that could not be read draws no arrows: the layer takes no presses. */
  canCreate: boolean;
  /**
   * Draw it. The board owns the document, the undo window and the selection, so the
   * tool asks for an arrow rather than writing one. An arrow the model refuses - two
   * ends on one object - is simply not on the board afterwards, which is the only
   * thing the tool could be told, and it needs no telling: the tool is still held,
   * and the next drag can be the one you meant.
   */
  onCreate(spec: ConnectorCreateSpec): void;
}

/** An arrow drag in progress, in board units. */
interface ArrowPress {
  pointerId: number;
  screenX: number;
  screenY: number;
  start: Point;
  /** Where the pointer last was. */
  x: number;
  y: number;
  moved: boolean;
}

/** What each end of the drag would become, and the object it was dropped onto. */
interface Drop {
  from: Endpoint;
  to: Endpoint;
  fromTarget: Attachable | null;
  toTarget: Attachable | null;
  /** The point the start end was drawn towards, and the end's the other way. */
  aimFrom: Point;
  aimTo: Point;
}

export function ConnectorTool({ doc, canCreate, onCreate }: ConnectorToolProps): JSX.Element {
  const { camera } = useBoardCamera();
  const press = useRef<ArrowPress | null>(null);
  /** The pointer's last position, board units: what the dots and preview follow. */
  const [pointer, setPointer] = useState<Point | null>(null);
  /** Whether a drag is being drawn, which is when the preview appears. */
  const [dragging, setDragging] = useState(false);

  const pointOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  /**
   * What the two ends would be if the pointer came up here: the object each is
   * dropped onto and the side each is drawn at, worked out by the model rather
   * than guessed here - which is why the highlighted dot is the side the arrow
   * ends up on, and why releasing on the spot changes nothing.
   */
  const dropOf = (start: Point, end: Point): Drop => {
    const fromTarget = attachTarget(doc, start);
    const toTarget = attachTarget(doc, end);
    // An end is attached to an object by aiming past it at what the arrow points
    // to: the start end aims at wherever the end is, and the end at the start.
    const aimFrom = toTarget === null ? end : centre(toTarget.rect);
    const aimTo = fromTarget === null ? start : centre(fromTarget.rect);
    return {
      from: endpointAtDrop(fromTarget, start, aimFrom),
      to: endpointAtDrop(toTarget, end, aimTo),
      fromTarget,
      toTarget,
      aimFrom,
      aimTo,
    };
  };

  /** The object whose side dots are shown: the one the pointer is over. */
  const shownOver = (point: Point): Attachable | null => attachTarget(doc, point);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Nothing behind this layer sees the press: no pan, no marquee, and the object
    // the press began on is neither moved nor resized.
    event.stopPropagation();
    if (!canCreate) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = pointOf(event);
    press.current = { pointerId: event.pointerId, screenX: event.clientX, screenY: event.clientY, start, x: start.x, y: start.y, moved: false };
    setPointer(start);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    const point = pointOf(event);
    if (current !== null && event.pointerId === current.pointerId) {
      event.stopPropagation();
      if (!current.moved && Math.hypot(event.clientX - current.screenX, event.clientY - current.screenY) < DRAG_THRESHOLD_PX) {
        return;
      }
      current.moved = true;
      current.x = point.x;
      current.y = point.y;
    }
    // the dots follow the pointer whether or not anything is being dragged
    setPointer(point);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    press.current = null;
    setDragging(false);
    const end = pointOf(event);
    setPointer(end);
    if (!current.moved) return; // a press that never travelled draws nothing
    const drop = dropOf(current.start, end);
    // Pressed and released on the same object: no arrow, and nothing else changes.
    if (drop.fromTarget !== null && drop.toTarget !== null && drop.fromTarget.id === drop.toTarget.id) return;
    // A line shorter than an arrow is drawn is a mis-click, not an arrow.
    if (Math.hypot(end.x - current.start.x, end.y - current.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    onCreate({ from: drop.from, to: drop.to });
  };

  // A drag cut short by the system draws no arrow, exactly as a marquee
  // cancelled at the edge of the window selects nothing.
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (press.current === null || event.pointerId !== press.current.pointerId) return;
    event.stopPropagation();
    press.current = null;
    setDragging(false);
    setPointer(null);
  };

  const over = pointer === null ? null : shownOver(pointer);
  const drop = press.current === null || pointer === null ? null : dropOf(press.current.start, pointer);
  /** The side the end being dragged would be drawn at, if any: that dot is the target.
   * The aim is the *other* end's, because a side is chosen by what the arrow points
   * at - and while the pointer is still over the object it started on there is no
   * arrow to point anywhere, so no side is lit. */
  const lit: Side | null =
    drop === null || drop.toTarget === null
      ? null
      : drop.fromTarget !== null && drop.fromTarget.id === drop.toTarget.id
        ? null
        : nearestSide(drop.toTarget.rect, drop.aimTo);
  const target = dragging ? drop?.toTarget ?? null : over;

  return (
    <div
      className="connector-tool-layer"
      data-testid="connector-tool-layer"
      data-can-create={canCreate}
      data-dragging={dragging}
      data-target={target === null ? '' : target.id}
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
      {target === null ? null : (
        <div className="connector-dots" data-testid="connector-dots" data-object={target.id}>
          {SIDES.map((side) => (
            <div
              key={side}
              className="connector-dot"
              data-testid="connector-dot"
              data-side={side}
              data-highlighted={dragging && lit === side}
              style={dotStyle(camera, sideOf(target, side))}
            />
          ))}
        </div>
      )}
      {dragging && press.current !== null ? (
        <svg className="connector-tool-svg" aria-hidden="true" focusable="false">
          <line
            className="connector-tool-preview"
            data-testid="connector-tool-preview"
            {...previewPoints(camera, press.current)}
          />
        </svg>
      ) : null}
    </div>
  );
}

/** The side's middle, from the geometry that decides it for every other drawing. */
function sideOf(object: Attachable, side: Side): Point {
  return sideAnchor(object.rect, side);
}

/** Where the preview line goes, in the layer's own screen pixels. */
function previewPoints(camera: CameraApi['camera'], current: ArrowPress) {
  const a = worldToScreen(camera, current.start);
  const b = worldToScreen(camera, { x: current.x, y: current.y });
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** A dot centred on a side, in the layer's own screen pixels. */
function dotStyle(camera: CameraApi['camera'], point: Point): CSSProperties {
  const at = worldToScreen(camera, point);
  return {
    left: `${at.x - CONNECTOR_DOT_RADIUS_PX}px`,
    top: `${at.y - CONNECTOR_DOT_RADIUS_PX}px`,
    width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
    height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
  };
}
