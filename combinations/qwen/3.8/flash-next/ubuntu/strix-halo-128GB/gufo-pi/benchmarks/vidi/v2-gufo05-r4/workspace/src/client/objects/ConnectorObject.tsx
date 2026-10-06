/**
 * An arrow on the board (`connector.ui`): a line from one thing to another, with a head.
 *
 * It is drawn from its snapshot's `points`, which the snapshot worked out from where the objects
 * at its ends currently are. That single fact is what makes an arrow follow a shape: nothing here
 * listens for a move, it is simply drawn again at wherever its ends resolve to, on every screen
 * that received the change (`connector.follow`).
 *
 * Three rules of its own:
 *
 *  - **it is clicked near its line, not inside its box.** A line is a metre of nothing on the
 *    screen, and a selection that grabbed every arrow whose bounding rectangle you happened to
 *    cross would make a diagram impossible to work in. So the surface is a stroke of
 *    `CONNECTOR_HIT_TOLERANCE_PX` *screen pixels* wide — divided by the zoom to become board
 *    units — and the rest of the box is transparent to the pointer, which then falls through to
 *    the board and starts a marquee as it should (`connector.select`, TC-20);
 *  - **a selected arrow shows its two ends as handles,** which can be dragged onto another thing
 *    to re-tie that end, or onto empty board to fix it there. Releasing onto the object at the
 *    other end is refused by the model and the handle snaps back — the write is the model's
 *    `setConnectorEndpoint`, not a local edit that hopes to agree with it later;
 *  - **the head is a board measurement.** Like the stroke, it scales with the board, so an arrow
 *    drawn at 100% is the same arrow at 200% rather than a thinner drawing of one.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { boardObjects, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { arrowheadPath, connectorBBox, polylinePath } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { setConnectorEndpoint, type ConnectorEnd, type ConnectorSnap } from '../../shared/objects/connector';
import { screenToWorld } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';
import { attachTargetAt } from './attachTargets';
import type { ObjectComponentProps } from './registry';

/**
 * Is `world` on this arrow?
 *
 * Within `CONNECTOR_HIT_TOLERANCE_PX` *screen* pixels of the line, which becomes board units by
 * dividing by the zoom — the click is a distance a person aims by, and it stays that distance
 * however far they have zoomed (`connector.select`).
 */
export function connectorHitTest(object: ObjectSnapshot, world: Point, zoom = 1): boolean {
  const points = (object as ConnectorSnap).points;
  if (!points || !world) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom || 1);
  return distanceToPolyline([points.from, points.to], world) <= tolerance;
}

/** One end being dragged somewhere else. */
interface Reattach {
  end: ConnectorEnd;
  /** Where the pointer is now, in board units. */
  world: Point;
  /** What it is over, and would tie itself to on release. */
  target: string | null;
}

export function ConnectorObject(props: ObjectComponentProps): JSX.Element {
  const connector = props.object as ConnectorSnap;
  const zoom = props.zoom || 1;
  const points = connector.points;
  const box = connectorBBox(points.from, points.to);
  // A perfectly horizontal or vertical arrow has no height or width at all; one unit of either
  // keeps the element, its box and its viewBox real without moving anything.
  const width = Math.max(box.width, 1);
  const height = Math.max(box.height, 1);
  const line = polylinePath([points.from, points.to]);
  const head = arrowheadPath(points.from, points.to, CONNECTOR_ARROWHEAD_SIZE_WORLD);

  const [reattach, setReattach] = useState<Reattach | null>(null);

  const latest = useRef(props);
  latest.current = props;
  const reattachRef = useRef<Reattach | null>(null);
  reattachRef.current = reattach;

  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = latest.current;
      const world = screenToWorld(current.camera, { x: event.clientX, y: event.clientY });
      // The pointer has to be near the line. In a browser it already is — the transparent stroke
      // is the only part of this element that answers to the pointer — and the same test is made
      // here so that the rule is one rule, measured once, rather than a stylesheet's idea of one.
      if (!connectorHitTest(current.object, world, current.zoom || 1)) return;
      if (current.transforming) return;
      current.gesture.onObjectPointerDown(event, current.object.id);
    },
    []
  );

  /** Start dragging one end of a selected arrow somewhere else (`connector.reattach`). */
  const beginReattach = useCallback(
    (end: ConnectorEnd) => (event: ReactPointerEvent<SVGCircleElement>) => {
      // The handle owns this gesture: the arrow must not be moved, nor the board panned, by it.
      event.stopPropagation();
      if (latest.current.transforming || latest.current.canEdit === false) return;
      const world = screenToWorld(latest.current.camera, { x: event.clientX, y: event.clientY });
      setReattach({ end, world, target: null });
    },
    []
  );

  const dragging = reattach !== null;

  // The listeners live on `window` for the length of the drag, which is what lets the pointer
  // wander off the arrow — over the shape it is meant to tie itself to — and keep working.
  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const world = screenToWorld(latest.current.camera, { x: event.clientX, y: event.clientY });
      const target = attachTargetAt(boardObjects(latest.current.doc), world, latest.current.zoom)?.id ?? null;
      setReattach((current) => (current ? { ...current, world, target } : current));
    };

    const release = (event: PointerEvent) => {
      const current = reattachRef.current;
      setReattach(null);
      if (!current || latest.current.canEdit === false) return;
      const world = screenToWorld(latest.current.camera, { x: event.clientX, y: event.clientY });
      // Over a thing, the end is tied to it; over nothing, it is fixed where the pointer let go.
      const target = attachTargetAt(boardObjects(latest.current.doc), world, latest.current.zoom);
      // One undo step for the re-tie, bounded on both sides (`undo.steps`), and the model's
      // answer is final: a refused release (the object at the other end, an arrow too short to
      // point anywhere, an arrow somebody deleted meanwhile) writes nothing and the handle goes
      // back to where it was.
      undoRef.current?.boundary();
      setConnectorEndpoint(
        latest.current.doc,
        latest.current.object.id,
        current.end,
        target ? { kind: 'attached', objectId: target.id } : { kind: 'free', x: world.x, y: world.y }
      );
      undoRef.current?.boundary();
    };

    // A cancelled pointer re-ties nothing: the handle snaps back on its own, because the stored
    // end was never touched.
    const cancel = () => setReattach(null);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
    };
    // Registered once for the length of a drag; everything it reads is through refs, so a move
    // of the camera or a remote edit in the middle of one cannot leave it holding old values.
  }, [dragging]);

  const boxStyle: CSSProperties = {
    left: box.x,
    top: box.y,
    width,
    height,
    // The box is a frame around a line, not a surface: only the stroke and the handles answer
    // to the pointer (`connector.select`).
    pointerEvents: 'none'
  };

  // The end that is not being dragged: the preview is drawn from it, so the arrow keeps pointing
  // the way it does while the other end is in the air.
  const anchorEnd = reattach && reattach.end === 'from' ? points.to : points.from;

  const handlesVisible = props.selected && props.selectedCount === 1 && !props.transforming && !reattach;
  const radius = CONNECTOR_DOT_RADIUS_PX / zoom;
  const interaction = props.transforming || reattach ? 'dragging' : 'idle';

  return (
    <div
      className="vidi6-connector"
      data-vidi6="connector"
      data-object-id={connector.id}
      data-object-type={connector.type}
      data-connector-id={connector.id}
      data-x={box.x}
      data-y={box.y}
      data-width={box.width}
      data-height={box.height}
      data-from={connector.from.kind}
      data-to={connector.to.kind}
      data-selected={props.selected ? 'true' : 'false'}
      data-interaction={interaction}
      role="group"
      aria-label="Connector"
      style={boxStyle}
      onPointerDown={handlePointerDown}
    >
      {/* The viewBox is the box in board units, so the line is drawn where the model says it is
          and a board measurement stays a board measurement. */}
      <svg
        className="vidi6-connector-svg"
        data-testid="connector-svg"
        width={width}
        height={height}
        viewBox={`${box.x} ${box.y} ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* The clickable surface: the same tolerance as the hit test, so what a person can see
            themselves aiming at and what the board accepts are one width. */}
        <path
          className="vidi6-connector-hit"
          data-vidi6="connector-hit"
          d={line}
          fill="none"
          stroke="transparent"
          strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX / zoom) * 2}
          style={{ pointerEvents: 'stroke' }}
        />
        <path className="vidi6-connector-line" data-vidi6="connector-line" d={line} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD} />
        <path className="vidi6-connector-head" data-vidi6="connector-head" d={head} />

        {reattach ? (
          // The preview of a dragged end: from the end that stayed put to the pointer, dashed
          // like the Shape tool's preview because it is a promise rather than a thing. What it
          // points at is the target the release would tie this end to.
          <g data-vidi6="connector-reattach" data-end={reattach.end} data-target={reattach.target ?? ''}>
            <path
              data-role="line"
              d={polylinePath([anchorEnd, reattach.world])}
              strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
            />
            <path data-role="head" d={arrowheadPath(anchorEnd, reattach.world, CONNECTOR_ARROWHEAD_SIZE_WORLD)} />
          </g>
        ) : null}

        {handlesVisible ? (
          <>
            <circle
              className="vidi6-connector-end"
              data-vidi6="connector-end"
              data-end="from"
              cx={points.from.x}
              cy={points.from.y}
              r={radius}
              style={{ pointerEvents: 'auto' }}
              onPointerDown={beginReattach('from')}
            />
            <circle
              className="vidi6-connector-end"
              data-vidi6="connector-end"
              data-end="to"
              cx={points.to.x}
              cy={points.to.y}
              r={radius}
              style={{ pointerEvents: 'auto' }}
              onPointerDown={beginReattach('to')}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}
