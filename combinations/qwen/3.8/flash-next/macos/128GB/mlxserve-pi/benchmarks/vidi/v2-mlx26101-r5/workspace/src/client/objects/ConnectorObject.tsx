/**
 * One arrow on the board: drawn, clicked, and — at its two ends only — moved.
 *
 * An arrow is the only object here that does not know where it is. Its two ends say what they are attached
 * to, and the line between them, the box around it and the handles at its ends are worked out again from
 * the shapes on the board every single time the board is read (see
 * `shared/geometry/connector-geometry.ts`). That is not a quirk of this component but the whole design of
 * the object: an arrow that *stored* its position would need a write for every frame of every drag of
 * every shape, by every person on the board, and would still arrive at the answer a transaction late. So
 * this component draws the answer to a question it asks again on every render — which is why a shape moved
 * in another tab has this arrow moving in this one with nothing to draw but the snapshot it was given.
 *
 * Three surfaces, from the outside in:
 * — a box that is deliberately transparent to the pointer. The box is the arrow's bounding rectangle, and
 *   a rectangle of nothing between two shapes that swallowed clicks would be a hole in the board: the shape
 *   behind it could not be clicked, and the board could not be panned by pressing the air next to the line,
 *   which is what air is for.
 * — a line with an arrowhead on the end, drawn where the two ends are.
 * — a wide invisible stroke over that line, and the only part of the arrow a pointer can catch hold of. It
 *   is six screen pixels either side at every zoom, which is what makes an arrow as easy to pick up at 50 %
 *   as at 200 %, and what stops a click in the middle of a big arrow's box from selecting it by accident.
 *
 * The two handles a selected arrow grows are the arrow's way of being re-aimed: drag one and let go over a
 * shape and that end goes on the shape; let go over nothing and the end stays at that point; let go over the
 * shape the *other* end is already on and the model refuses, the handle goes back where it came from, and
 * the arrow stays an arrow.
 */

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_HANDLE_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint, type ConnectorSnapshot, type Endpoint } from '../../shared/objects/connector';
import { topmostObjectAt } from './registry';
import type { ObjectProps } from './registry';

/** The registry key of an arrow, and the value of its `type` field. */
export const CONNECTOR_OBJECT_TYPE = 'connector';

/** Which end of the arrow a gesture is holding. */
export type ConnectorEnd = 'from' | 'to';

/**
 * How wide the invisible stroke a pointer can catch is, in world units, at this zoom.
 *
 * Six screen pixels either side, and the world is `zoom` screen pixels to the unit, so the tolerance is
 * divided by the zoom — which is the whole of why an arrow is exactly as hard to click at one zoom as at
 * another, and why this number is in the config in screen pixels rather than in world units.
 */
export const connectorHitWidth = (zoom: number): number =>
  (2 * CONNECTOR_HIT_TOLERANCE_PX) / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);

/** An arrowhead: the point, the two shoulders behind it, and where the line stops to make room for it. */
export interface Arrowhead {
  tip: Point;
  base: Point;
  corners: [Point, Point];
}

/**
 * The arrowhead, drawn backwards from the end the arrow points at.
 *
 * The line is drawn to the head's base rather than to its tip, so that the point of an arrow is the point
 * of the arrow and not the place where a stroke happens to have stopped. An arrow of no length at all —
 * both ends at the same point, which the model refuses on creation but a document can still be holding
 * from a client that did not — has no direction to point in, and nothing is drawn.
 */
export function arrowhead(from: Point, to: Point, size: number): Arrowhead | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const angle = Math.atan2(dy, dx);
  const base = { x: to.x - size * Math.cos(angle), y: to.y - size * Math.sin(angle) };
  const shoulder = size * 0.4;
  return {
    tip: to,
    base,
    corners: [
      { x: base.x + shoulder * Math.cos(angle + Math.PI / 2), y: base.y + shoulder * Math.sin(angle + Math.PI / 2) },
      { x: base.x + shoulder * Math.cos(angle - Math.PI / 2), y: base.y + shoulder * Math.sin(angle - Math.PI / 2) },
    ],
  };
}

/** What it says out loud. An end on a shape is "a shape"; nobody is told which one, and nobody is served by being told. */
export function connectorAriaLabel(obj: ConnectorSnapshot): string {
  const said = (end: Endpoint): string => (end.kind === 'attached' ? 'a shape' : 'nothing');
  return `Arrow from ${said(obj.from)} to ${said(obj.to)}`;
}

/**
 * What one end is on, in the form a test reads out of the DOM: the object's id, or `free`.
 */
const endDescription = (end: Endpoint): string => (end.kind === 'attached' ? end.objectId : 'free');

/**
 * A number the document holds, or the value a drawing that cannot be drawn should fall back to.
 *
 * An arrow's width and height are optional in every object's shape — an object that has never been resized
 * has none — and an arrow has no size of its own to have never been resized, so the numbers this component
 * is handed are the ones `deriveConnectorBoxes` wrote and nothing else. Read once, here, into four locals,
 * so that the div, the svg inside it and the line inside that cannot disagree about a size read twice.
 */
const numberOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The arrow, drawn between wherever its ends are right now.
 *
 * It is given the box the snapshot derived (see `deriveConnectorBoxes`) and it resolves its own ends, and
 * the two are the same arithmetic on the same rectangles — which is the one place in this file where a
 * disagreement between them would be visible on the screen, and the reason the box is not derived a second
 * time here.
 */
export function ConnectorObject(props: ObjectProps<ConnectorSnapshot>): React.JSX.Element | null {
  const { obj, doc, selected, zoom, editable, board } = props;
  /** The end a handle is holding, and where the pointer has carried it to. */
  const [drag, setDrag] = useState<{ end: ConnectorEnd; point: Point } | null>(null);

  const rects = board?.rects ?? new Map<string, never>();
  const ends = resolveEndpoints({ from: obj.from, to: obj.to }, rects);
  // The end being dragged is drawn at the pointer rather than at its document position: a handle that
  // stays where it was while it is being dragged is a handle that is not being dragged.
  const drawn: { from: Point; to: Point } =
    drag === null ? ends : drag.end === 'from' ? { from: drag.point, to: ends.to } : { from: ends.from, to: drag.point };

  const box = { x: numberOr(obj.x, Number.NaN), y: numberOr(obj.y, Number.NaN), width: Math.max(numberOr(obj.width, 0), 0), height: Math.max(numberOr(obj.height, 0), 0) };
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
  /** A point on the board as a point inside this object's own box, which is what an SVG is drawn in. */
  const local = (point: Point): Point => ({ x: point.x - box.x, y: point.y - box.y });
  const from = local(drawn.from);
  const to = local(drawn.to);

  // Everything the drag handlers below need comes through this ref: they are installed once per pickup and
  // outlive every render the drag's own re-renders cause.
  const latest = useRef({ props, ends, rects });
  latest.current = { props, ends, rects };

  /**
   * The pointer went down on an end handle.
   *
   * Stopped where it stands: the board must not read this press as a press on the air over the board — a
   * pan, and a selection dropped — and the arrow must not read it as a request to select the arrow that is
   * already selected.
   */
  const beginHandleDrag = (end: ConnectorEnd) => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (!editable) return; // a handle on a board that cannot be written to is a handle that cannot be dragged
    const world = latest.current.props.board?.toWorld({ x: event.clientX, y: event.clientY });
    setDrag({ end, point: world ?? ends[end] });
  };

  const end = drag?.end ?? null;
  useEffect(() => {
    if (end === null) return;

    const onPointerMove = (event: PointerEvent) => {
      event.stopPropagation();
      const world = latest.current.props.board?.toWorld({ x: event.clientX, y: event.clientY });
      if (world !== undefined) setDrag((current) => (current === null ? current : { end: current.end, point: world }));
    };

    const onPointerUp = (event: PointerEvent) => {
      event.stopPropagation();
      const finished = event.type === 'pointerup';
      const view = latest.current;
      const world = view.props.board?.toWorld({ x: event.clientX, y: event.clientY });
      setDrag(null);
      // A pointer the system took back put the end nowhere, which is the only honest reading of it.
      if (!finished || world === undefined) return;

      // The topmost object under the release point, this arrow itself excepted: an arrow's end does not
      // belong on the arrow it is the end of, and the object underneath is the thing a person meant.
      const target = topmostObjectAt(
        (view.props.board?.objects ?? []).filter((object) => object.id !== obj.id),
        world,
        { zoom: view.props.zoom, rects: view.rects },
      );
      const next: Endpoint =
        target === null
          ? // Over nothing: the end is a point now, fixed where the pointer was let go.
            { kind: 'free', x: world.x, y: world.y }
          : // Over a shape: attached to it, with the release point as its fallback. Which *side* of the
            // shape it lands on is the model's to choose — it is the only thing that knows where the other
            // end ended up.
            { kind: 'attached', objectId: target.id, fallback: world };

      const history = view.props.undo;
      history?.boundary();
      // False is the model refusing to put this end on the object the other end is already on, or an arrow
      // that stopped existing mid-drag. The handle goes back where it came from and nothing is written,
      // which is a refusal a person can see rather than one they have to read a manual for.
      setConnectorEndpoint(doc, obj.id, end, next);
      history?.boundary();
    };

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
    // One set of listeners per handle picked up. `obj.id` and `doc` are in the dependency list because they
    // are what the drop is written against; neither changes during a drag.
  }, [end, doc, obj.id]);

  const head = arrowhead(drawn.from, drawn.to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const lineEnd = head === null ? to : local(head.base);

  /**
   * A press on the line itself: the arrow is selected, and that is all that happens.
   *
   * An arrow is not dragged. Where it is comes from where its ends are, so a group-move gesture that wrote
   * this arrow's four numbers would be a position the next frame threw away — and a write that shows
   * nothing is an undo step that undoes nothing. The ends are moved by their handles, which is the way an
   * arrow can honestly be moved.
   */
  const onLinePointerDown = (event: ReactPointerEvent<SVGLineElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    props.onSelect(obj.id);
  };

  return (
    <div
      aria-label={connectorAriaLabel(obj)}
      className="connector-object"
      data-from={endDescription(obj.from)}
      data-height={box.height}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-testid="connector-object"
      data-to={endDescription(obj.to)}
      data-width={box.width}
      data-x={box.x}
      data-y={box.y}
      data-z={obj.z}
      role="img"
      style={
        {
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: Math.max(box.width, 0),
          height: Math.max(box.height, 0),
          // The box is nothing; the line inside it is something. See the note at the top of this file.
          pointerEvents: 'none',
        } as React.CSSProperties
      }
    >
      <svg
        className="connector-object-svg"
        data-testid="connector-object-svg"
        height={Math.max(box.height, 0)}
        style={{ overflow: 'visible', display: 'block' } as React.CSSProperties}
        width={Math.max(box.width, 0)}
      >
        <line
          className="connector-line"
          data-testid="connector-line"
          stroke={CONNECTOR_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          x1={from.x}
          x2={lineEnd.x}
          y1={from.y}
          y2={lineEnd.y}
        />
        {head === null ? null : (
          <polygon
            className="connector-head"
            data-testid="connector-head"
            fill={CONNECTOR_COLOR}
            points={`${to.x},${to.y} ${local(head.corners[0]).x},${local(head.corners[0]).y} ${
              local(head.corners[1]).x
            },${local(head.corners[1]).y}`}
            stroke="none"
          />
        )}
        <line
          className="connector-hit"
          data-stroke-width={connectorHitWidth(zoom)}
          data-testid="connector-hit"
          pointerEvents="stroke"
          stroke="transparent"
          strokeWidth={connectorHitWidth(zoom)}
          x1={from.x}
          x2={to.x}
          y1={from.y}
          y2={to.y}
          onPointerDown={onLinePointerDown}
        />
      </svg>
      {selected
        ? (['from', 'to'] as const).map((which) => {
            const at = local(drawn[which]);
            return (
              <div
                key={which}
                aria-label={which === 'from' ? 'Arrow start handle' : 'Arrow end handle'}
                className="connector-handle"
                data-handle={`connector-${which}`}
                data-testid={`connector-handle-${which}`}
                role="button"
                style={
                  {
                    position: 'absolute',
                    left: at.x,
                    top: at.y,
                    width: `${CONNECTOR_HANDLE_RADIUS_PX * 2}px`,
                    height: `${CONNECTOR_HANDLE_RADIUS_PX * 2}px`,
                    // A handle is a fixed size on the screen whatever the board is scaled to, which is what
                    // every other handle on this board does and why `--inv-zoom` is set for it.
                    transform: 'translate(-50%, -50%) scale(var(--inv-zoom, 1))',
                    pointerEvents: 'auto',
                  } as React.CSSProperties
                }
                onPointerDown={beginHandleDrag(which)}
              />
            );
          })
        : null}
    </div>
  );
}
