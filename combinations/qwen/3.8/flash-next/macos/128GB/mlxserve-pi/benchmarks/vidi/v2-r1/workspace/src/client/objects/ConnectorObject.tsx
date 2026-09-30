// An arrow between two things, that follows them when they move (`connector.ui`,
// `connector.follow`, `connector.select`, `connector.reattach`).
//
// The whole point of a connector is that it is not a shape with a position. What is
// stored is *what its two ends point at* — an object, or a place on the board — and the
// line you see is worked out from that and from where those objects are now. So:
//
//   - **Nothing is written when an object moves.** The document says "this end is
//     attached to that shape"; the shape's new rectangle arrives from wherever it was
//     moved; `resolveEndpoints` is called again on this screen and draws the arrow at
//     the new place. That is why an arrow follows on every screen at once with no extra
//     message and no second opinion — and why an arrow that followed by *writing* would
//     be a fight between people who all think they are right.
//
//   - **The target is picked by side, not stored.** An attached end keeps no memory of
//     which edge it was attached to: the side is the one facing the other end, recomputed
//     every time, so an arrow turns over to a new side as objects pass each other
//     (TC-25) rather than stretching through the shape it is attached to.
//
//   - **Being clicked is measured in pixels, and drawn in pixels.** An arrow's box is
//     mostly empty air, and a click inside the box but far from the line must not select
//     it (TC-20). So the arrow's own pointer target is a transparent stroke as wide as
//     twice the hit tolerance in board units — six *screen* pixels' worth at this zoom,
//     which is exactly the distance `hitTestConnector` says a click had to be within.
//     The rule and the target are the same number, so the browser's own hit-testing
//     cannot disagree with the function the tests check.
//
// Like every other object, this one is drawn in world units and positioned by the world
// layer's transform; only the handles that belong to the selection are counter-scaled,
// so they stay the size of a handle at any zoom.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import { objectBounds, snapshotObjects } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  connectorHitWidthWorld,
  connectorPointsOf,
  setConnectorEndpoint,
  type ConnectorSnapshot,
} from '../../shared/objects/connector';
import {
  CONNECTOR_ENDS,
  shortenSegment,
  type ConnectorEnd,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { unitDirection } from '../../shared/geometry/polyline';
import { screenToWorld, type Camera } from '../canvas/camera';
import { useBoardCamera } from '../canvas/BoardViewport';
import type { UndoController } from '../board/undo';

/** How wide a selected arrow's end handle is, in screen pixels. */
const HANDLE_PX = 9;

/** How wide an arrowhead is, as a fraction of how long it is. */
const ARROWHEAD_WIDTH = 0.9;

export interface ConnectorObjectProps {
  connector: ConnectorSnapshot;
  /** Every other object's box, from the same snapshot this arrow's box came from. */
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  /** False on a board this screen cannot write to: no handles, no dragging. */
  editable: boolean;
  /** The generic press, so an arrow is selected like anything else is. */
  onObjectPointerDown(event: PointerEvent, id: string): void;
  /** This tab's undo history; a re-attach is one step. */
  undo?: UndoController;
}

export function ConnectorObject({
  connector,
  rects,
  doc,
  zoom,
  selected,
  editable,
  onObjectPointerDown,
  undo,
}: ConnectorObjectProps): ReactNode {
  // The camera comes from the viewport this arrow is drawn in: a handle has to turn the
  // screen position a pointer is at into board units, and only the viewport knows the
  // one this screen is looking through.
  const { camera } = useBoardCamera();
  const [from, to] = connectorPointsOf(connector, rects);
  const box = connectorBoxOf(from, to);
  const direction = unitDirection(from, to);
  // The head's point is the end of the arrow. The line stops where the head's back edge
  // is, so the point stands at the end instead of the line running through it into the
  // object the arrow points at. A head never eats more than half the arrow.
  const headLength = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD, distance(from, to) / 2);
  const lineEnd = shortenSegment(from, to, headLength);

  const onPointerDown = (event: ReactPointerEvent<SVGPolylineElement>): void => {
    if (!editable || event.button !== 0) return;
    // The board underneath does not pan, and the objects behind are not clicked.
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onObjectPointerDown(event.nativeEvent, connector.id);
  };

  return (
    <div
      data-testid="connector-object"
      data-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      style={boxStyle(box)}
    >
      <svg
        data-testid="connector-object-svg"
        style={svgStyle}
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        focusable="false"
        aria-hidden="true"
      >
        {/* The target first, and invisible: as wide as the tolerance, so the only clicks
            that can land here are the ones the model would call a hit. */}
        <polyline
          data-testid="connector-hit"
          points={`${from.x},${from.y} ${to.x},${to.y}`}
          fill="none"
          stroke="transparent"
          strokeWidth={connectorHitWidthWorld(zoom)}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={onPointerDown}
        />
        <line
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={lineEnd.x}
          y2={lineEnd.y}
          stroke={CONNECTOR_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
        />
        <polygon
          data-testid="connector-arrowhead"
          points={arrowheadPoints(to, direction, headLength)}
          fill={CONNECTOR_COLOR}
        />
      </svg>
      {selected && editable
        ? CONNECTOR_ENDS.map((end) => (
            <ConnectorHandle
              key={end}
              end={end}
              at={end === 'from' ? from : to}
              connector={connector}
              doc={doc}
              camera={camera}
              zoom={zoom}
              undo={undo}
            />
          ))
        : null}
    </div>
  );
}

/**
 * One end of a selected arrow: the square you drag to move that end (`connector.
 * reattach`). Releasing over an object attaches the end to it; releasing over empty
 * board makes it a free point where it was let go; releasing over the object the *other*
 * end is attached to is refused by the model and the handle snaps back (TC-21).
 */
function ConnectorHandle({
  end,
  at,
  connector,
  doc,
  camera,
  zoom,
  undo,
}: {
  end: ConnectorEnd;
  at: Point;
  connector: ConnectorSnapshot;
  doc: Y.Doc;
  camera: Camera;
  zoom: number;
  undo?: UndoController;
}): ReactNode {

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    const world = screenToWorld(camera, { x: event.clientX, y: event.clientY });
    // What is under the handle is read from the document as the pointer lifts, not from
    // the render this drag started in: somebody may have moved something meanwhile.
    const target = topObjectAt(snapshotObjects(doc), world, connector.id);
    const endpoint: Endpoint = target
      ? { kind: 'attached', objectId: target.id }
      : { kind: 'free', x: world.x, y: world.y };
    // A re-attach is one undo step and one write: the model works out the anchor to
    // store, and refuses an end that is already at the other side of this arrow.
    undo?.boundary();
    setConnectorEndpoint(doc, connector.id, end, endpoint);
    undo?.boundary();
  };

  return (
    <div
      data-testid={`connector-handle-${end}`}
      data-end={end}
      aria-label={`Arrow ${end} end`}
      style={handleStyle(at, zoom)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

/** The topmost object under a point, whatever kind it is, excluding one of them. */
export function topObjectAt(
  objects: readonly BoardObject[],
  point: Point,
  exceptId?: string,
): BoardObject | null {
  // The same rule the marquee uses, so a handle is released onto exactly the object a
  // drag of the same box would have selected: the topmost one containing the point.
  const box: Rect = { x: point.x, y: point.y, width: 0, height: 0 };
  let best: BoardObject | null = null;
  for (const object of objects) {
    // An arrow is not something an arrow's end attaches to.
    if (object.type === 'connector') continue;
    if (object.id === exceptId) continue;
    if (!rectContains(objectBounds(object), box)) continue;
    if (best === null || object.z >= best.z) best = object;
  }
  return best;
}

/**
 * The three points of an arrowhead whose tip is at `tip`, pointing along `direction`,
 * `length` long: the tip, and the two corners of its back edge.
 */
export function arrowheadPoints(tip: Point, direction: Point, length: number): string {
  if (!(length > 0)) return `${tip.x},${tip.y}`;
  const back = { x: tip.x - direction.x * length, y: tip.y - direction.y * length };
  // Half the head's width, at right angles to the way it points.
  const half = (length * ARROWHEAD_WIDTH) / 2;
  const normal = { x: -direction.y * half, y: direction.x * half };
  return [
    `${tip.x},${tip.y}`,
    `${back.x + normal.x},${back.y + normal.y}`,
    `${back.x - normal.x},${back.y - normal.y}`,
  ].join(' ');
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The box an arrow is drawn in: what it spans, plus its own thickness. */
const connectorBoxOf = (from: Point, to: Point): Rect => {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    // An arrow that is perfectly flat still has a box, because it still has a thickness
    // to grab, and a box of no height is a box nothing can be inside.
    width: Math.max(Math.abs(to.x - from.x), CONNECTOR_STROKE_WIDTH_WORLD),
    height: Math.max(Math.abs(to.y - from.y), CONNECTOR_STROKE_WIDTH_WORLD),
  };
};

const boxStyle = (box: Rect): CSSProperties => ({
  position: 'absolute',
  left: box.x,
  top: box.y,
  width: box.width,
  height: box.height,
  // An arrow's handles belong outside the span it draws, and the line is drawn to it.
  overflow: 'visible',
  // The box is not the arrow: only the target stroke and the handles take the pointer.
  pointerEvents: 'none',
});

const svgStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  display: 'block',
  overflow: 'visible',
  pointerEvents: 'none',
};

const handleStyle = (at: Point, zoom: number): CSSProperties => ({
  position: 'absolute',
  left: at.x,
  top: at.y,
  width: HANDLE_PX,
  height: HANDLE_PX,
  boxSizing: 'border-box',
  // A handle is a screen thing: it stays this big however far the board is zoomed.
  transform: zoom > 0 ? `translate(-50%, -50%) scale(${1 / zoom})` : 'translate(-50%, -50%)',
  border: '1px solid #1f2328',
  backgroundColor: '#ffffff',
  borderRadius: 2,
  cursor: 'grab',
  pointerEvents: 'auto',
  touchAction: 'none',
});
