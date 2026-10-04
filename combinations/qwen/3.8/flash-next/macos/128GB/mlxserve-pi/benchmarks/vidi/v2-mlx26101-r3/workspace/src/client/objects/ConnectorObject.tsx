import { useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { asConnectorSnapshot, connectorPoints, setConnectorEndpoint } from '../../shared/objects/connector';
import { type End } from '../../shared/geometry/connector-geometry';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { useBoard, useBoardRects, type BoardServices } from '../board/BoardContext';
import { endpointAt } from './connectorTarget';
import { onDragEnds, worldPoint } from '../tools/boardPointer';
import type { ObjectProps } from './registry';

/**
 * Story 10's props of an arrow. The design's `{ connector, rects, doc, selected, zoom }` is what this
 * draws from, and every one of those five arrives: four of them from the board's object loop, which
 * hands the same props to every type so that one drag can move a note, a heading and an arrow
 * together, and `rects` from the board's context, because a map of where *everything* is is not a
 * thing to carry in the props of one object.
 */
export type ConnectorObjectProps = ObjectProps;

/** The radius of an end handle, in screen pixels: big enough to press at any zoom. */
const HANDLE_RADIUS_PX = 6;

/** Room around the arrow's box, in board units, for the head, the handles and the hit stroke. */
const PAD = CONNECTOR_ARROWHEAD_SIZE_WORLD * 2;

/**
 * A point in the arrow's own drawing space: board units, measured from the corner its drawing starts
 * at, which is `origin` - the box of the arrow with the room around it already taken off.
 *
 * This is the one place the arrow's two coordinate systems meet, and it is worth being exact about
 * because a mistake here is invisible on the board and obvious in the drawing: the box is in board
 * units, the `<svg>` is the same size as the box plus the room on either side, and the top-left of the
 * drawing is the top-left of that room. Adding the room a second time - which is what this looked like
 * for a while, because the corner handed in already has it taken off - draws the arrow a room's width
 * below and to the right of the ends it is fastened to: the arrow still moves with its shapes, still
 * reports its ends correctly, and is drawn in the wrong place. Only a browser can tell.
 */
function local(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

/**
 * An arrow: a line, a head at one end, and two ends that can be moved.
 *
 * The line is drawn where its ends *are*, which is not the same as where they were written down. An
 * end fastened to a shape is stored as the shape rather than as a point on it, so every render asks
 * the geometry the same question - which side of that shape is facing the other end, and where is the
 * middle of it - and draws the answer. That is the whole of why arrows follow shapes across a network
 * without one extra write: there is nothing to keep up to date, because nothing was kept. A shape
 * moves, the snapshot changes, this renders again, and the arrow that comes out is fastened to the
 * shape's new position because the question was asked of the new box. The same functions answer it on
 * every screen looking at the board, which is what "on every screen" means in practice.
 *
 * It is drawn inside its own box, which for an arrow is the rectangle around its two ends - a box a
 * client that cannot do this arithmetic still has, because the arrow was created with one. The box is
 * a photograph of the moment the arrow was drawn; the line is the live thing, and this drawing reads
 * the live thing and uses the photograph only to know how much of the world to draw on.
 */
export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { object, doc, zoom, selected, canEdit = true, onObjectPointerDown } = props;
  const rects = useBoardRects();
  const board = useBoard();
  // One end being dragged, in board units. That is the only place a dragged handle's position is
  // kept: the arrow is not written while the handle is in the air, so letting go somewhere the model
  // does not approve of leaves the arrow exactly where it was. That is the snap-back, and it needs no
  // code that puts anything back - only the absence of a write.
  const [drag, setDrag] = useState<{ end: End; point: Point } | null>(null);
  const dragRef = useRef<{ end: End; pointerId: number } | null>(null);
  // The camera and the board, for the listeners of a handle drag: read from refs because a handle
  // dragged across a board that is being zoomed or reconnected should convert the pointer by the
  // camera it is over now, and because reinstalling those listeners mid-drag would lose the drag.
  const cameraRef = useRef<Camera>(cameraOf(zoom));
  const servicesRef = useRef<BoardServices | null>(board);

  const connector = asConnectorSnapshot(object);

  useEffect(() => {
    cameraRef.current = board?.camera ?? cameraOf(zoom);
    servicesRef.current = board;
  });

  useEffect(() => {
    const end = dragRef.current?.end;
    if (end === undefined) {
      return;
    }
    const move = (event: PointerEvent): void => {
      const current = dragRef.current;
      if (current === null || event.pointerId !== current.pointerId) {
        return;
      }
      setDrag({ end, point: worldPoint(cameraRef.current, event) });
    };
    const up = (event: PointerEvent): void => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (current === null || event.pointerId !== current.pointerId) {
        return;
      }
      const services = servicesRef.current;
      if (services === null || !services.canEdit) {
        return;
      }
      const world = worldPoint(cameraRef.current, event);
      services.undo?.boundary();
      // The same two questions as when the arrow was first drawn: is the pointer over a thing this end
      // can be fastened to, or is it now a point on the board. The model decides which it is and
      // whether it will have it - an end let go on the object the other end is fastened to is refused,
      // and so is an arrow too short to be an arrow.
      setConnectorEndpoint(services.doc, object.id, end, endpointAt(services.objects, world));
      services.undo?.boundary();
    };
    const stop = onDragEnds(move, up);
    return () => {
      stop();
      // A handle whose arrow stopped being drawn is a handle whose drag is over - Escape, a delete, a
      // navigation. Nothing is written, because nothing was written while it was in the air.
      dragRef.current = null;
    };
  }, [drag?.end, doc, object.id]);

  if (connector === null) {
    // Not an arrow, or an arrow this client cannot draw. The board skips objects of unknown types;
    // this is the same answer from the inside.
    return <></>;
  }

  const points = connectorPoints(connector, rects);
  const drawn = drag === null ? points : { ...points, [drag.end]: drag.point };
  const origin = { x: object.x - PAD, y: object.y - PAD };
  const from = local(drawn.from, origin);
  const to = local(drawn.to, origin);
  // The head sits at the far end, pointing the way the arrow goes, and the line stops short of it by
  // the head's own length: a line drawn all the way to the tip comes out of the point of its own
  // arrow, which is the one thing that makes an arrow look wrong.
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const unit = length > 0 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
  const size = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const half = size / 2;
  const head = [
    `${to.x},${to.y}`,
    `${to.x - unit.x * size + unit.y * half},${to.y - unit.y * size - unit.x * half}`,
    `${to.x - unit.x * size - unit.y * half},${to.y - unit.y * size + unit.x * half}`,
  ].join(' ');
  const tail = { x: to.x - unit.x * size, y: to.y - unit.y * size };
  // A handle is a thing a thumb has to press, so it is drawn in screen size and converted back into
  // board units: the same reason the hit stroke is as wide as six screen pixels rather than six units.
  const invZoom = zoom > 0 ? 1 / zoom : 1;

  const startDrag = (event: ReactPointerEvent<SVGCircleElement>, end: End): void => {
    // A handle is grabbed, not used to carry the arrow about: the press stops here rather than becoming
    // a move of the object, a pan or a marquee.
    event.stopPropagation();
    if (!canEdit) {
      return;
    }
    dragRef.current = { end, pointerId: event.pointerId };
    setDrag({
      end,
      point: worldPoint(cameraRef.current, { clientX: event.clientX, clientY: event.clientY }),
    });
  };

  const onHitPointerDown = (event: ReactPointerEvent<SVGLineElement>): void => {
    event.stopPropagation();
    onObjectPointerDown(event, object.id);
  };

  return (
    <div
      className="connector-object"
      data-connector-object=""
      data-testid="connector-object"
      data-object-id={object.id}
      data-object-type={object.type}
      data-x={object.x}
      data-y={object.y}
      data-width={object.width}
      data-height={object.height}
      data-z={object.z}
      data-selected={selected ? 'true' : 'false'}
      data-from-end={connector.from.kind}
      data-to-end={connector.to.kind}
      // Which shape each end is fastened to, as well as what kind of end it is: the drawn point says
      // where the arrow is today, and this says what it would go back to if that shape moved.
      data-from-target={connector.from.kind === 'attached' ? connector.from.objectId : ''}
      data-to-target={connector.to.kind === 'attached' ? connector.to.objectId : ''}
      data-from-x={points.from.x}
      data-from-y={points.from.y}
      data-to-x={points.to.x}
      data-to-y={points.to.y}
      role="group"
      aria-label="Connector"
      style={{
        left: `${object.x - PAD}px`,
        top: `${object.y - PAD}px`,
        width: `${object.width + PAD * 2}px`,
        height: `${object.height + PAD * 2}px`,
      }}
    >
      <svg
        className="connector-object__svg"
        width={object.width + PAD * 2}
        height={object.height + PAD * 2}
        aria-hidden="true"
      >
        <line
          className="connector-object__hit"
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeWidth={CONNECTOR_HIT_TOLERANCE_PX * 2 * invZoom}
          onPointerDown={onHitPointerDown}
        />
        <line
          className="connector-object__line"
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={tail.x}
          y2={tail.y}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        <polygon
          className="connector-object__head"
          data-testid="connector-arrowhead"
          points={head}
        />
        {selected
          ? (['from', 'to'] as readonly End[]).map((end) => {
              const at = end === 'from' ? from : to;
              return (
                <circle
                  key={end}
                  className="connector-object__handle"
                  data-testid={`connector-handle-${end}`}
                  data-end={end}
                  cx={at.x}
                  cy={at.y}
                  r={HANDLE_RADIUS_PX * invZoom}
                  onPointerDown={(event) => {
                    startDrag(event, end);
                  }}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}

/**
 * A camera for an object that was handed a zoom and nothing else.
 *
 * The board's camera is in the context and is used when there is one. This is the fallback for a
 * component drawn on its own in front of a document of its own, which is what a component test does:
 * the board is where the screen starts and the zoom is the one that was given, which is the whole of
 * what a test that never pans and never zooms can tell the difference between.
 */
function cameraOf(zoom: number): Camera {
  return { x: 0, y: 0, zoom: zoom > 0 ? zoom : 1 };
}
