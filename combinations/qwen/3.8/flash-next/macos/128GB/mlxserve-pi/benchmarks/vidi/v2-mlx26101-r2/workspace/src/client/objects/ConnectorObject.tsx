import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config.js';
import type { Point, Rect } from '../../shared/board-model.js';
import { CONNECTOR_TYPE, type ConnectorSnap } from '../../shared/objects/connector.js';
import {
  connectorBBox,
  resolveEndpoints,
  type ConnectorEnd,
} from '../../shared/geometry/connector-geometry.js';
import { setConnectorEndpoint } from '../../shared/objects/connector.js';
import { objectAtPoint } from '../tools/objectAtPoint.js';
import type { ObjectProps } from './registry.js';

/**
 * One arrow on the board (`src/client/objects/ConnectorObject.tsx`) - the component
 * the registry points at for the `connector` type.
 *
 * It draws nothing that the document does not already know. The two ends come from
 * `resolveEndpoints`, which asks each attached end's object where its facing side is
 * *now*, so an arrow is redrawn in the right place on every screen whenever anything
 * moves - and writes nothing while doing it (`connector.follow`). That is the whole
 * design of the type in one line: the arrow is an *opinion about two boxes*, held up
 * to date, rather than a shape with a position of its own.
 *
 * Three consequences of that, each of which is a decision the component has to make
 * rather than a detail of drawing:
 *
 * - **the box is the line's, and it is honest.** The SVG covers the two ends plus
 *   padding for the arrowhead; an arrow that runs straight down has a box of no
 *   width. It is padded out for drawing, never for hitting.
 * - **it is hit by its line, not its box** (`connector.select`): a transparent
 *   stroke as wide as `CONNECTOR_HIT_TOLERANCE_PX` divided by the zoom, so the click
 *   that selects is within six *screen* pixels of the arrow at any zoom, and a click
 *   inside the box but far from the line selects nothing.
 * - **dragging its middle moves nothing.** There is no position to move; an arrow
 *   goes where its ends are. Its ends are moved by the two handles.
 */

/** The board has no rectangles to offer: every attached end is drawn at its fallback. */
const NO_RECTS: ReadonlyMap<string, Rect> = new Map<string, Rect>();

/** The handle's radius, in screen pixels at any zoom. */
const HANDLE_RADIUS_PX = 6;

/** Room for the arrowhead and the stroke outside the two ends, in board units. */
const PAD_WORLD = CONNECTOR_ARROWHEAD_SIZE_WORLD + 4 * CONNECTOR_STROKE_WIDTH_WORLD;

export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { object, doc, zoom, selected, canEdit = true, selection, snapshot, rects, undo } = props;
  const connector = object as ConnectorSnap;

  /** Which end is being dragged to a new object, if any. */
  const [draggingEnd, setDraggingEnd] = useState<ConnectorEnd | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const dragRef = useRef<{ end: ConnectorEnd; start: Point; clientX: number; clientY: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const live = rects ?? NO_RECTS;
  const resolved = resolveEndpoints({ from: connector.from, to: connector.to }, live);
  // The end being dragged is drawn at the pointer while it is in the air; the
  // document is not told until the release, so a drag that is cancelled leaves
  // nothing behind.
  const ends =
    draggingEnd !== null && cursor !== null
      ? { ...resolved, [draggingEnd]: cursor }
      : resolved;

  const box = connectorBBox(ends.from, ends.to);
  const left = box.x - PAD_WORLD;
  const top = box.y - PAD_WORLD;
  const width = box.width + PAD_WORLD * 2;
  const height = box.height + PAD_WORLD * 2;
  const local = (point: Point): Point => ({ x: point.x - left, y: point.y - top });

  const from = local(ends.from);
  const to = local(ends.to);
  const line = `${from.x},${from.y} ${to.x},${to.y}`;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      // The arrow answers the click itself, and the board behind it is not told:
      // selecting an arrow must not clear the selection it just joined, and must not
      // start a pan under the arrow that was clicked.
      event.stopPropagation();
      if (event.shiftKey) selection.toggle(object.id);
      else selection.click(object.id);
    },
    [object.id, selection],
  );

  /** Start dragging one end of a selected arrow to another object (`connector.reattach`). */
  const handleHandlePointerDown = (end: ConnectorEnd) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!canEdit || !selected) return;
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = {
      end,
      start: end === 'from' ? ends.from : ends.to,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setDraggingEnd(end);
    setCursor(dragRef.current.start);
  };

  // The drag is watched on the window, not on the handle: the pointer is on its way
  // away from a six pixel circle the moment it moves, and an end that is only half
  // dragged is worse than one that was never started.
  useEffect(() => {
    if (draggingEnd === null) return;
    const move = (event: PointerEvent | MouseEvent) => {
      const drag = dragRef.current;
      if (drag === null) return;
      const scale = zoomRef.current || 1;
      setCursor({
        x: drag.start.x + (event.clientX - drag.clientX) / scale,
        y: drag.start.y + (event.clientY - drag.clientY) / scale,
      });
    };

    const up = (event: PointerEvent | MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDraggingEnd(null);
      setCursor(null);
      if (drag === null) return;
      const scale = zoomRef.current || 1;
      const point = {
        x: drag.start.x + (event.clientX - drag.clientX) / scale,
        y: drag.start.y + (event.clientY - drag.clientY) / scale,
      };
      // Over an object the end joins it; over nothing it is fixed where it was
      // dropped. Either way this object is not a target for its own end, and the
      // object at the other end is refused by the model, which is the case that
      // makes the handle snap back.
      const others = (snapshotRef.current ?? []).filter(
        (candidate) => candidate.id !== object.id && candidate.type !== CONNECTOR_TYPE,
      );
      const target = objectAtPoint(others, point);
      undo?.boundary();
      setConnectorEndpoint(
        doc,
        object.id,
        drag.end,
        target === null
          ? { kind: 'free', x: point.x, y: point.y }
          : { kind: 'attached', objectId: target.id, fallback: point },
      );
      undo?.boundary();
    };

    const cancel = () => {
      dragRef.current = null;
      setDraggingEnd(null);
      setCursor(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [draggingEnd, doc, object.id, undo]);

  const head = arrowHead(from, to);

  return (
    <svg
      className="connector-object"
      data-testid="connector-object"
      data-object-id={object.id}
      data-connector-object={object.id}
      data-selected={selected ? 'true' : 'false'}
      data-from-kind={connector.from.kind}
      data-to-kind={connector.to.kind}
      role="img"
      aria-label="Connector"
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: String(connector.z),
      }}
    >
      {/* The line a person aimed at: as wide as the hit tolerance at this zoom, and
          the only part of this box that answers a click. */}
      <polyline
        className="connector-hit"
        data-testid="connector-hit"
        points={line}
        fill="none"
        strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / (zoom || 1)}
        pointerEvents="stroke"
        onPointerDown={handlePointerDown}
      />
      <polyline
        className="connector-line"
        data-testid="connector-line"
        points={line}
        fill="none"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        pointerEvents="none"
      />
      {head !== null ? (
        <polygon
          className="connector-arrowhead"
          data-testid="connector-arrowhead"
          points={head}
          pointerEvents="none"
        />
      ) : null}
      {selected
        ? (['from', 'to'] as const).map((end) => {
            const point = end === 'from' ? from : to;
            return (
              <circle
                key={end}
                className="connector-handle"
                data-testid="connector-handle"
                data-end={end}
                cx={point.x}
                cy={point.y}
                r={HANDLE_RADIUS_PX / (zoom || 1)}
                pointerEvents="all"
                onPointerDown={handleHandlePointerDown(end)}
              />
            );
          })
        : null}
    </svg>
  );
}

/**
 * The arrowhead as a triangle at the head end, pointing along the line. `null` for
 * an arrow whose ends are in the same place, which draws no line to point anywhere.
 */
function arrowHead(from: Point, to: Point): string | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const size = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const ux = dx / length;
  const uy = dy / length;
  // The barbs are set back along the line and off to either side of it; a third of
  // the length either way is the width that reads as an arrowhead rather than a
  // flare at both zoom extremes.
  const backX = to.x - ux * size;
  const backY = to.y - uy * size;
  const wingX = -uy * (size / 3);
  const wingY = ux * (size / 3);
  return [
    `${to.x},${to.y}`,
    `${backX + wingX},${backY + wingY}`,
    `${backX - wingX},${backY - wingY}`,
  ].join(' ');
}

export default ConnectorObject;
