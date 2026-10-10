import { useCallback, useEffect, useRef, useState } from 'react';
import { objectBounds, objectSnapshots } from '../../shared/board-model';
import {
  completeConnectorEndpoints,
  connectorAnchorRectsFrom,
  setConnectorEndpoint,
  type ConnectorSnapshot,
  type Endpoint,
  type EndpointInput,
} from '../../shared/objects/connector';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { rectContainsPoint, type Point, type Rect } from '../../shared/geometry';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  DEFAULT_SHAPE_STROKE,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import { useBoardUndo } from '../board/useUndo';
import { worldPointOf } from '../tools/toolPointer';
import type { ConnectorEnd } from '../../shared/objects/connector';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One connector (anchors `connector.follow`, `connector.render`,
 * `connector.reconnect`).
 *
 * The arrow is drawn to `obj.points` - the two ends the board model resolved from
 * the stored endpoints against the objects they are attached to, in the same pass
 * that produced the snapshot. That is the whole of `connector.follow`: this
 * component never looks up an attached object, never recomputes an anchor and has
 * no idea what the object at either end is. A remote move, a resize or a detach
 * re-resolves the ends, and the arrow is simply drawn somewhere else, in the same
 * frame as the object it belongs to (TC-13, TC-26).
 *
 * Two things are drawn for the same line: an invisible one as wide as the selection
 * tolerance, which is what a click actually lands on, and the arrow itself. The
 * tolerance is `CONNECTOR_HIT_TOLERANCE_PX` in **screen** pixels, so the world-unit
 * width of that band is `2 * tolerance / zoom` - an arrow is exactly as easy to
 * click at 25% as at 400% (`connector.tolerance`).
 *
 * When it is selected, each end gets a handle. Dragging one re-attaches that end
 * (`connector.reconnect`): onto an object it snaps to that object's nearest side,
 * over empty space it becomes a free end at the point it was released, and onto the
 * object the *other* end is already attached to the model refuses it and the end
 * stays where it was (TC-21).
 */
export type ConnectorObjectProps = ObjectProps<ConnectorSnapshot>;

/**
 * An arrow is drawn in the same default outline colour a shape gets
 * (`shape.colours`): the two are drawn together, and a connector has no colour of
 * its own to choose in story 10.
 */
const COLOUR = SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE];

/**
 * Is this world point on this arrow? Distance to the two-point polyline, in world
 * units, against the screen tolerance converted to world units at this zoom
 * (`connector.tolerance`, TC-20). A connector has no fill: only the line, and the
 * band around it, is on it.
 */
export function hitTestConnector(
  obj: ConnectorSnapshot,
  worldPoint: Point,
  zoom: number,
): boolean {
  const points = obj?.points;
  if (!points) {
    return false;
  }
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  return distanceToPolyline([points.from, points.to], worldPoint) <= tolerance;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const {
    obj: connector,
    doc,
    zoom,
    selected,
    dragging,
    editable = true,
    onObjectPointerDown,
    surface,
  } = props;

  const undo = useBoardUndo();
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** One end being re-attached: the arrow as it would be if it ended here. */
  const [preview, setPreview] = useState<{ from: Point; to: Point } | null>(null);

  const width = connector.width;
  const height = connector.height;
  const from = connector.points.from;
  const to = connector.points.to;

  /** World units inside this component; screen pixels outside it. */
  const local = (point: Point): Point => ({ x: point.x - connector.x, y: point.y - connector.y });

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.stopPropagation();
      if (event.button !== 0) {
        return;
      }
      // Selecting an arrow is the board's gesture like selecting anything else;
      // the gesture then refuses to *move* it, because its position is derived.
      onObjectPointerDown(event as unknown as PointerEventLike, connector.id);
    },
    [connector.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    // A connector holds no text, so a double-click edits nothing (`sel.registry`:
    // `editableText: false`) and must not create one either.
    event.stopPropagation();
    event.preventDefault();
  }, []);

  /**
   * Where a window pointer event landed, in world units - the same conversion the
   * two tools use, from the same surface, so that a handle dropped on an object is
   * on the object the board is pointing at.
   */
  const worldOf = useCallback(
    (event: { clientX: number; clientY: number }): Point | null => worldPointOf(event, surface ?? null),
    [surface],
  );

  /**
   * Re-attach one end (`connector.reconnect`, TC-21).
   *
   * The objects a handle may snap to are read once, when the drag starts: what the
   * board is showing at the moment the person commits to moving the end. A frame
   * that re-read the board would chase a remote change mid-drag.
   */
  const startHandleDrag = useCallback(
    (end: ConnectorEnd) => {
      if (!editable) {
        return;
      }
      const snapshotAtStart = objectSnapshots(doc);
      const otherEnd: ConnectorEnd = end === 'from' ? 'to' : 'from';
      const other = connector[otherEnd];
      // The objects a handle may join, and the rectangles they are joined to, read
      // once for the whole drag - the same completion `setConnectorEndpoint` will do.
      const rects = connectorAnchorRectsFrom(snapshotAtStart);
      const stored = (endpoint: Endpoint): EndpointInput =>
        endpoint.kind === 'attached'
          ? { kind: 'attached', objectId: endpoint.objectId }
          : { kind: 'free', x: endpoint.x, y: endpoint.y };

      const targetAt = (world: Point): { id: string; rect: Rect } | null => {
        for (let index = snapshotAtStart.length - 1; index >= 0; index -= 1) {
          const obj = snapshotAtStart[index];
          if (!obj || obj.type === 'connector' || obj.id === connector.id) {
            continue; // an arrow does not attach to an arrow, or to itself
          }
          const rect = objectBounds(obj);
          if (rectContainsPoint(rect, world)) {
            return { id: obj.id, rect };
          }
        }
        return null;
      };

      /**
       * The object at the other end of this arrow. An end is not allowed to join its
       * own arrow at both ends, and the model is the one that says so - this only
       * knows it early enough to stop showing a preview of something that will not
       * happen (`connector.reattach`, TC-21).
       */
      const isOtherEnd = (target: { id: string } | null): boolean =>
        target !== null && other.kind === 'attached' && target.id === other.objectId;

      undo?.boundary();

      const onMove = (event: PointerEvent) => {
        const world = worldOf(event);
        if (!world) {
          return;
        }
        event.stopPropagation();
        const target = targetAt(world);
        if (isOtherEnd(target)) {
          // Hovering the object the other end is on: nothing will change, so nothing
          // new is drawn - the arrow keeps being drawn exactly where it is.
          setPreview(null);
          return;
        }
        // Over an object the end joins it; over empty space it is free at the
        // pointer. Either way the arrow shown is the one the model would store,
        // computed the way the model computes it (`connector.reconnect`).
        const moved: EndpointInput = target
          ? { kind: 'attached', objectId: target.id }
          : { kind: 'free', x: world.x, y: world.y };
        const completed =
          end === 'from'
            ? completeConnectorEndpoints(moved, stored(other), rects)
            : completeConnectorEndpoints(stored(other), moved, rects);
        setPreview(completed ? resolveEndpoints(completed, rects) : null);
      };

      const onUp = (event: PointerEvent) => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        setPreview(null);
        const world = worldOf(event);
        if (!world) {
          undo?.boundary();
          return;
        }
        const target = targetAt(world);
        // Over an object: attached to the side the pointer is nearest. Over empty
        // space: a free end at exactly this point. Over the object at the *other*
        // end, the input is still offered to the model, which refuses it, writes
        // nothing and leaves the end where it was - which is what "snaps back" means
        // (TC-21).
        const next: EndpointInput = target
          ? { kind: 'attached', objectId: target.id }
          : { kind: 'free', x: world.x, y: world.y };
        // `false` is a normal ending: the object at the other end, or an end that
        // did not move. The document is unchanged, so the arrow is still where it
        // was - which is what "snaps back" means (TC-21).
        setConnectorEndpoint(doc, connector.id, end, next);
        undo?.boundary();
      };

      const onCancel = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        setPreview(null);
        undo?.boundary(); // nothing was written; the step is closed anyway
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
    },
    [connector, doc, editable, undo, worldOf],
  );

  // A re-attach drag this component started must not outlive it.
  useEffect(() => () => setPreview(null), []);

  const markerId = `connector-arrowhead-${connector.id}`;
  const lineFrom = local(preview ? preview.from : from);
  const lineTo = local(preview ? preview.to : to);
  const hitRadius = CONNECTOR_HIT_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const handleRadius = CONNECTOR_DOT_RADIUS_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const showHandles = selected && editable && !dragging;

  return (
    <div
      className="connector-object"
      data-testid={`connector-object-${connector.id}`}
      data-connector={connector.id}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${connector.x}px, ${connector.y}px)`,
        zIndex: connector.z,
      }}
    >
      <svg
        ref={svgRef}
        className="connector-object__svg"
        data-testid={`connector-${connector.id}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M0,0.8 L9,5 L0,9.2 Z" fill={COLOUR} />
          </marker>
        </defs>
        {/* The band a click lands on: as wide as the selection tolerance, invisible. */}
        <line
          className="connector-object__hit"
          data-testid={`connector-hit-${connector.id}`}
          x1={lineFrom.x}
          y1={lineFrom.y}
          x2={lineTo.x}
          y2={lineTo.y}
          stroke="transparent"
          strokeWidth={hitRadius * 2}
          pointerEvents="stroke"
        />
        <line
          className="connector-object__line"
          data-testid={`connector-line-${connector.id}`}
          x1={lineFrom.x}
          y1={lineFrom.y}
          x2={lineTo.x}
          y2={lineTo.y}
          stroke={COLOUR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeDasharray={preview ? `${4 / (zoom || 1)}` : undefined}
          markerEnd={`url(#${markerId})`}
          pointerEvents="none"
        />
        {showHandles
          ? ([
              ['from', lineFrom],
              ['to', lineTo],
            ] as const).map(([end, point]) => (
              <circle
                key={end}
                className="connector-object__handle"
                data-testid={`connector-handle-${end}`}
                data-end={end}
                cx={point.x}
                cy={point.y}
                r={handleRadius}
                strokeWidth={1 / (zoom || 1)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.button !== 0) {
                    return;
                  }
                  startHandleDrag(end);
                }}
              />
            ))
          : null}
      </svg>
    </div>
  );
}
