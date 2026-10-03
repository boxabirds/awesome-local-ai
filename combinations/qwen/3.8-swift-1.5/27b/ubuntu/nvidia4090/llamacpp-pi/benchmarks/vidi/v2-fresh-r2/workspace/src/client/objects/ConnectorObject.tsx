/**
 * Connector object component (story 10, connector.object).
 *
 * Renders the arrow: a line between the resolved endpoints with a
 * triangular arrowhead at the target end. The line itself is not
 * interactive (selection is a 6px-tolerance hit test on the empty-board
 * click, connector.hit). When selected, two endpoint dots appear; dragging
 * one re-attaches it to the object under the pointer (or to a free point),
 * live-updating the arrow (connector.re_attach).
 */

import { useCallback, useMemo, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import {
  endpointReference,
  resolveEndpoints,
  sideAnchor,
  nearestSide,
} from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import type { ObjectProps } from './registry';

/** Arrow colour (dark grey). */
const LINE_COLOR = '#6b7280';
/** Selected-dot colour. */
const DOT_COLOR = '#1a73e8';

interface ConnectorData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
}

interface DragState {
  end: 'from' | 'to';
  point: Point;
  hoverId: string | null;
}

/** The topmost non-connector object under a world point (excluding `exclude`). */
function hitObject(
  objects: readonly ObjectSnapshot[],
  p: Point,
  exclude: string | undefined,
): ObjectSnapshot | undefined {
  let best: ObjectSnapshot | undefined;
  for (const o of objects) {
    if (o.id === exclude) continue;
    if (o.type === 'connector') continue;
    const b = objectBounds(o);
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
      if (!best || o.z >= best.z) best = o;
    }
  }
  return best;
}

export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected } = props;
  // BoardPage passes both for every object; connectors need them to resolve
  // endpoints and hit-test re-attach targets.
  const objects = props.objects ?? [];
  const camera = props.camera!;
  const conn = obj as unknown as ConnectorData;
  const [drag, setDrag] = useState<DragState | null>(null);

  const rects = useMemo(
    () => new Map<string, Rect>(objects.map((o) => [o.id, objectBounds(o)])),
    [objects],
  );

  // The drawn endpoints (a dragged end follows the pointer as a free point).
  const from: Endpoint = drag?.end === 'from' ? { kind: 'free', ...drag.point } : conn.from;
  const to: Endpoint = drag?.end === 'to' ? { kind: 'free', ...drag.point } : conn.to;
  const ends = resolveEndpoints({ from, to }, rects);

  // Geometry in coordinates relative to the (derived) bbox origin.
  const ox = conn.x;
  const oy = conn.y;
  const p1: Point = { x: ends.from.x - ox, y: ends.from.y - oy };
  const p2: Point = { x: ends.to.x - ox, y: ends.to.y - oy };

  // Arrowhead triangle at p2 pointing along p1 → p2.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const L = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const head: [Point, Point] = [
    { x: p2.x - ux * L + -uy * (L * 0.6), y: p2.y - uy * L + ux * (L * 0.6) },
    { x: p2.x - ux * L + uy * (L * 0.6), y: p2.y - uy * L + -ux * (L * 0.6) },
  ];

  const dotR = CONNECTOR_DOT_RADIUS_PX / zoom;

  const worldPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point =>
      screenToWorld(camera, { x: e.clientX, y: e.clientY }),
    [camera],
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent<SVGCircleElement>, end: 'from' | 'to') => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = worldPoint(e);
      const other = end === 'from' ? conn.to : conn.from;
      const hover =
        other.kind === 'attached'
          ? hitObject(objects, p, other.objectId)?.id
          : hitObject(objects, p, undefined)?.id;
      setDrag({ end, point: p, hoverId: hover ?? null });
    },
    [conn.to, conn.from, objects, worldPoint],
  );

  const onDragMove = useCallback(
    (e: ReactPointerEvent<SVGCircleElement>, end: 'from' | 'to') => {
      const p = worldPoint(e);
      const other = end === 'from' ? conn.to : conn.from;
      const hover =
        other.kind === 'attached'
          ? hitObject(objects, p, other.objectId)?.id
          : hitObject(objects, p, undefined)?.id;
      setDrag({ end, point: p, hoverId: hover ?? null });
    },
    [conn.to, conn.from, objects, worldPoint],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<SVGCircleElement>, end: 'from' | 'to') => {
      const p = worldPoint(e);
      const other = end === 'from' ? conn.to : conn.from;
      const hover =
        other.kind === 'attached'
          ? hitObject(objects, p, other.objectId)
          : hitObject(objects, p, undefined);
      let next: Endpoint;
      if (hover) {
        // Fresh fallback = the hovered object's side anchor facing the other end.
        const otherRef = endpointReference(other, rects);
        const anchor = sideAnchor(objectBounds(hover), nearestSide(objectBounds(hover), otherRef));
        next = { kind: 'attached', objectId: hover.id, fallback: anchor };
      } else {
        next = { kind: 'free', x: p.x, y: p.y };
      }
      setConnectorEndpoint(doc, conn.id, end, next);
      setDrag(null);
    },
    [doc, conn.id, conn.to, conn.from, objects, rects, worldPoint],
  );

  // Hover highlight during a drag (the object the end will attach to).
  const hoverRect = drag?.hoverId ? rects.get(drag.hoverId) : undefined;

  return (
    <div
      role="group"
      aria-label="Connector"
      data-testid="connector-object"
      data-connector-id={conn.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: ox,
        top: oy,
        width: Math.max(conn.width, 1),
        height: Math.max(conn.height, 1),
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        width={Math.max(conn.width, 1)}
        height={Math.max(conn.height, 1)}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* The line (not interactive — selection is the tolerance hit test). */}
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={LINE_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
        />
        {/* Arrowhead at the target end. */}
        <polygon
          points={`${p2.x},${p2.y} ${head[0].x},${head[0].y} ${head[1].x},${head[1].y}`}
          fill={LINE_COLOR}
        />
        {/* Hover highlight during re-attach. */}
        {hoverRect && (
          <rect
            x={hoverRect.x - ox}
            y={hoverRect.y - oy}
            width={hoverRect.width}
            height={hoverRect.height}
            fill="none"
            stroke={DOT_COLOR}
            strokeWidth={2 / zoom}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          />
        )}
        {/* Endpoint dots (selected only) — the re-attach handles. */}
        {selected && (
          <>
            <circle
              data-testid="connector-dot-from"
              cx={p1.x}
              cy={p1.y}
              r={dotR}
              fill="#fff"
              stroke={DOT_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
              onPointerDown={(e) => startDrag(e, 'from')}
              onPointerMove={(e) => drag?.end === 'from' && onDragMove(e, 'from')}
              onPointerUp={(e) => drag?.end === 'from' && endDrag(e, 'from')}
              onPointerCancel={(e) => drag?.end === 'from' && endDrag(e, 'from')}
            />
            <circle
              data-testid="connector-dot-to"
              cx={p2.x}
              cy={p2.y}
              r={dotR}
              fill="#fff"
              stroke={DOT_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
              onPointerDown={(e) => startDrag(e, 'to')}
              onPointerMove={(e) => drag?.end === 'to' && onDragMove(e, 'to')}
              onPointerUp={(e) => drag?.end === 'to' && endDrag(e, 'to')}
              onPointerCancel={(e) => drag?.end === 'to' && endDrag(e, 'to')}
            />
          </>
        )}
      </svg>
    </div>
  );
}
