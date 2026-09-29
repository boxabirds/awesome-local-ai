// An arrow between two objects on the board (story 10).
//
// What makes it different from every other object is that its own geometry is
// NOT its own: the two ends of the line are where the objects it points at ARE.
// So nothing here ever draws a stored position. Each render asks the shared
// geometry - the same function the board model asks when it derives this
// connector's box - for the point on each end's object that faces the other end,
// and draws between those. Move a shape and the arrow is redrawn from the shape's
// new rectangle on the next render; delete it and the model has already turned
// the end free, so the arrow stays exactly where the shape was without this
// component noticing anything.
//
// Its own selection, moving and deleting are the story 7 machinery's (a connector
// is not resizable, so it gets no resize handles). What lives here is the only
// thing specific to an arrow: the two end handles, and the rule that dragging one
// re-points that end at whatever object it is dropped on, and lets it go free in
// the air otherwise - one write per drop, through the model, as one undo step.
import { useRef, useState } from 'react';
import type React from 'react';
import { getConnectorEnds, rectsById, setConnectorEndpoint } from '../../shared/objects/connector.ts';
import type { Endpoint } from '../../shared/objects/connector.ts';
import {
  nearestSide,
  referencePoint,
  resolveEndpoints,
  sideAnchor,
} from '../../shared/geometry/connector-geometry.ts';
import type { Point, Rect } from '../../shared/geometry.ts';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config.ts';
import { objectsSnapshot, type ObjectSnapshot } from '../../shared/board-model.ts';
import type { ConnectorSnapshot } from '../../shared/objects/connector.ts';
import { useUndoController } from '../board/useUndo.ts';
import type { ObjectProps } from './registry.tsx';

const LINE_COLOR = '#4a4a4a';
const HANDLE_COLOR = '#2563eb';

// World space added around the line's box so a perfectly horizontal or vertical
// arrow - whose box has no height, or no width - is still drawn and still hit.
const PAD = 32;

interface EndDrag {
  end: 'from' | 'to';
  startScreen: Point;
  startWorld: Point;
  world: Point;
  targetId: string | null;
}

// The object an end would land on: the topmost non-connector with a box under the
// point, never the arrow's own id. An arrow is not a legal target in this story -
// an arrow pointing at an arrow has no side to leave from.
function dropTarget(
  rects: ReadonlyMap<string, Rect>,
  snapshots: readonly ObjectSnapshot[],
  point: Point,
  exclude: string,
): string | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const obj = snapshots[i];
    if (obj.type === 'connector' || obj.id === exclude) continue;
    const rect = rects.get(obj.id);
    if (!rect) continue;
    if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
      return obj.id;
    }
  }
  return null;
}

// A pointer delta in screen pixels is a delta in world units divided by the zoom:
// the layer this arrow is drawn in is scaled by the camera, and the camera's pan
// cancels out of a difference. That is why re-pointing an end needs the zoom and
// nothing else about the view.
function worldOfDrag(drag: EndDrag, e: { clientX: number; clientY: number }, zoom: number): Point {
  const z = zoom > 0 ? zoom : 1;
  return {
    x: drag.startWorld.x + (e.clientX - drag.startScreen.x) / z,
    y: drag.startWorld.y + (e.clientY - drag.startScreen.y) / z,
  };
}

// The triangle at the arrow's business end, in world units, pointing along the
// line. Written out rather than used through a <marker> because the two ends move
// every frame and a marker's own geometry cannot follow a line that moves.
function arrowheadPoints(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return '';
  const ux = dx / length;
  const uy = dy / length;
  const size = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const half = size * 0.5;
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  return [
    `${to.x},${to.y}`,
    `${base.x - uy * half},${base.y + ux * half}`,
    `${base.x + uy * half},${base.y - ux * half}`,
  ].join(' ');
}

export function ConnectorObject(props: ObjectProps): React.JSX.Element {
  const { obj, doc, zoom, selected, editable, onObjectPointerDown } = props;
  const connector = obj as ConnectorSnapshot;
  const undo = useUndoController();
  const dragRef = useRef<EndDrag | null>(null);
  const [drag, setDrag] = useState<EndDrag | null>(null);

  // Read from the live document every render: the objects the ends point at may
  // have moved, and this component must show the arrow they imply NOW rather than
  // the one that was true when it last drew.
  const rects = rectsById(doc);
  const ends = getConnectorEnds(doc, obj.id);
  const resolved = ends ? resolveEndpoints(ends, rects) : null;

  if (!ends || !resolved) {
    // Not a connector, or its ends are unreadable: draw nothing, but draw it
    // safely - one malformed object must never break the board.
    return (
      <div
        data-testid={`connector-${obj.id}`}
        data-broken="true"
        style={{ position: 'absolute', left: obj.x, top: obj.y, width: 0, height: 0, pointerEvents: 'none' }}
      />
    );
  }

  const zoomSafe = zoom > 0 ? zoom : 1;
  const handleRadius = CONNECTOR_DOT_RADIUS_PX / zoomSafe;

  // Where an end draws: its resolved anchor; while its handle is dragged, the
  // pointer - snapped to the side of the object it is hovering.
  const pointOf = (end: 'from' | 'to'): Point => {
    const base = resolved[end];
    if (!drag || drag.end !== end) return base;
    const other = end === 'from' ? ends.to : ends.from;
    if (drag.targetId) {
      const rect = rects.get(drag.targetId);
      if (rect) return sideAnchor(rect, nearestSide(rect, referencePoint(other, rects)));
    }
    return drag.world;
  };

  const a = pointOf('from');
  const b = pointOf('to');
  const minX = Math.min(a.x, b.x) - PAD;
  const minY = Math.min(a.y, b.y) - PAD;
  const width = Math.abs(b.x - a.x) + PAD * 2;
  const height = Math.abs(b.y - a.y) + PAD * 2;

  const onLineDown = (e: React.PointerEvent<SVGLineElement>) => {
    if (e.button !== 0) return;
    if (!editable) return; // a board that cannot be edited still pans over arrows
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  };

  const startDrag = (end: 'from' | 'to') => (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return;
    // The handle belongs to the arrow, not to the selection: grabbing it re-points
    // that end instead of moving anything.
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    const start = pointOf(end);
    const next: EndDrag = {
      end,
      startScreen: { x: e.clientX, y: e.clientY },
      startWorld: start,
      world: start,
      targetId: null,
    };
    dragRef.current = next;
    setDrag(next);
    try {
      (e.currentTarget as unknown as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }
  };

  const moveDrag = (end: 'from' | 'to') => (e: React.PointerEvent<SVGGElement>) => {
    const current = dragRef.current;
    if (!current || current.end !== end) return;
    const world = worldOfDrag(current, e, zoomSafe);
    const next: EndDrag = { ...current, world, targetId: dropTarget(rects, objectsSnapshot(doc), world, obj.id) };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = (end: 'from' | 'to') => (e: React.PointerEvent<SVGGElement>) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    try {
      (e.currentTarget as unknown as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }
    if (!current || current.end !== end) return;

    const world = worldOfDrag(current, e, zoomSafe);
    const targetId = dropTarget(rects, objectsSnapshot(doc), world, obj.id);

    // One write per drop - attach when it landed on an object, let go where it was
    // released when it did not - and one undo step either way. A drop the model
    // refuses (an end onto the object the other end already holds) is simply not
    // written: the line is resolved from the model every render, so an unwritten
    // end is already back where it started.
    undo?.boundary();
    if (targetId) {
      const attached: Endpoint = { kind: 'attached', objectId: targetId, fallback: world };
      setConnectorEndpoint(doc, obj.id, end, attached);
    } else {
      setConnectorEndpoint(doc, obj.id, end, { kind: 'free', x: world.x, y: world.y });
    }
    undo?.boundary();
  };

  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const handle = (end: 'from' | 'to', point: Point) => (
    <g
      key={end}
      data-testid={`connector-handle-${end}`}
      data-connector-end={end}
      data-target={drag && drag.end === end ? (drag.targetId ?? '') : ''}
      style={{
        cursor: 'grab',
        // The box this handle sits in cannot be clicked at all - see the container -
        // so a handle has to ask for its own pointer events back, or the pointer
        // falls through it onto the line underneath and re-pointing an end is
        // impossible to do with a real mouse.
        pointerEvents: 'auto',
      }}
      onPointerDown={startDrag(end)}
      onPointerMove={moveDrag(end)}
      onPointerUp={endDrag(end)}
      onPointerCancel={cancelDrag}
    >
      {/* The dot, and a transparent ring around it that is what the pointer
          actually finds. Both are sized in world units from the screen radius
          divided by the zoom, so they stay the same size on screen at any zoom. */}
      <circle cx={point.x} cy={point.y} r={handleRadius * 2.5} fill="transparent" />
      <circle
        cx={point.x}
        cy={point.y}
        r={handleRadius}
        fill="#ffffff"
        stroke={HANDLE_COLOR}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );

  const arrow = arrowheadPoints(a, b);

  return (
    <div
      role="group"
      aria-label={`Connector from ${connector.from?.kind === 'attached' ? `object ${connector.from.objectId}` : 'free point'} to ${connector.to?.kind === 'attached' ? `object ${connector.to.objectId}` : 'free point'}`}
      data-testid={`connector-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      data-dragging={drag ? 'true' : 'false'}
      data-from-end={connector.from?.kind ?? ''}
      data-to-end={connector.to?.kind ?? ''}
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width,
        height,
        // The box is only a frame: everything that can be clicked is drawn inside
        // it, so an arrow laid across a shape never steals that shape's clicks.
        pointerEvents: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        data-testid={`connector-graphic-${obj.id}`}
        width={width}
        height={height}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
        aria-hidden="true"
      >
        {/* The line, drawn in world coordinates and stroked at a constant screen
            width. The invisible thick one under it is the click target, and it is
            exactly as wide as the hit tolerance the hit test uses: what you can
            hit is what the board selects.

            Its width is the tolerance DIVIDED BY THE ZOOM, in world units, rather
            than a screen-constant stroke. A `vector-effect: non-scaling-stroke`
            would say the same thing more neatly, and Chrome does draw it at a
            constant screen width - but it hit-tests the scaled stroke, so the
            clickable band would grow with zoom while the model's tolerance stayed
            at 6 px of screen, and the two would disagree about what a click on the
            board near an arrow means. Measured, not assumed: at 200% the band was
            12 px of screen either side of the line instead of 6. */}
        <line
          data-testid={`connector-hit-${obj.id}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="transparent"
          strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX * 2) / zoomSafe}
          style={{ pointerEvents: 'stroke', cursor: editable ? 'pointer' : 'default' }}
          onPointerDown={onLineDown}
        />
        <line
          data-testid={`connector-line-${obj.id}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={LINE_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          vectorEffect="non-scaling-stroke"
          data-from-x={a.x}
          data-from-y={a.y}
          data-to-x={b.x}
          data-to-y={b.y}
        />
        {selected ? (
          <line
            data-testid={`connector-selection-${obj.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={HANDLE_COLOR}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD + 3}
            strokeOpacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {arrow ? <polygon data-testid={`connector-arrow-${obj.id}`} points={arrow} fill={LINE_COLOR} /> : null}
        {selected ? handle('from', a) : null}
        {selected ? handle('to', b) : null}
      </svg>
    </div>
  );
}
