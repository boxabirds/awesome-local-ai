// One connector object: an SVG line with an arrowhead drawn from the resolved
// endpoints, so a moved object makes the arrow follow with no writes. Selection
// uses a precise distance-to-line hit (CONNECTOR_HIT_TOLERANCE_PX in screen
// space), not the bbox; when selected it shows a handle at each end that drags
// to re-attach to another object, to a free point, or snaps back when dropped
// on the opposite end's own object (a self-connector is refused with no write).

import { useCallback, useMemo, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import {
  connectorBBox,
  resolveEndpoints,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import type { ConnectorSnap } from '../../shared/board-model';
import type { ObjectProps } from './registry';

export type ConnectorObjectProps = ObjectProps;

function rectsFromSnapshot(
  snapshot: readonly ObjectSnapshot[] | undefined,
): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  if (!snapshot) return rects;
  for (const o of snapshot) {
    if (o.type === 'connector') continue;
    rects.set(o.id, { x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 });
  }
  return rects;
}

// Topmost non-connector object under a world point (last by z wins).
function topmostUnder(
  rects: ReadonlyMap<string, Rect>,
  snapshot: readonly ObjectSnapshot[] | undefined,
  point: Point,
): Rect & { id: string } | undefined {
  if (!snapshot) return undefined;
  let best: (Rect & { id: string }) | undefined;
  for (const o of snapshot) {
    if (o.type === 'connector') continue;
    const r = { x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 };
    if (!rectContains(r, { x: point.x, y: point.y, width: 0, height: 0 })) continue;
    if (!best || o.z >= bestIdZ(snapshot, best.id)) best = { ...r, id: o.id };
  }
  return best;
}

function bestIdZ(snapshot: readonly ObjectSnapshot[], id: string): number {
  return snapshot.find((o) => o.id === id)?.z ?? 0;
}

export function ConnectorObject({
  obj,
  doc,
  zoom,
  selected,
  undo,
  onObjectPointerDown,
  snapshot,
  clientToWorld,
}: ConnectorObjectProps): React.JSX.Element {
  const conn = obj as ConnectorSnap;
  const rects = useMemo(() => rectsFromSnapshot(snapshot), [snapshot]);
  const { from, to } = useMemo(() => resolveEndpoints(conn, rects), [conn, rects]);
  const bbox = connectorBBox(from, to);

  // Degenerate boxes (axis-aligned lines) still need a positive-sized element.
  const w = Math.max(bbox.width, 1);
  const h = Math.max(bbox.height, 1);
  const fx = from.x - bbox.x;
  const fy = from.y - bbox.y;
  const tx = to.x - bbox.x;
  const ty = to.y - bbox.y;

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const ah = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const head = `${tx},${ty} ${tx - ah * Math.cos(angle - Math.PI / 6)},${ty - ah * Math.sin(angle - Math.PI / 6)} ${tx - ah * Math.cos(angle + Math.PI / 6)},${ty - ah * Math.sin(angle + Math.PI / 6)}`;

  const handleR = CONNECTOR_DOT_RADIUS_PX / (zoom || 1);
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom || 1);

  const dragRef = useRef<{ end: 'from' | 'to'; other: Endpoint } | null>(null);

  const nearLine = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (!clientToWorld) return true;
      const p = clientToWorld(e.clientX, e.clientY);
      const tol = CONNECTOR_HIT_TOLERANCE_PX / (zoom || 1);
      return distanceToPolyline([from, to], p) <= tol;
    },
    [clientToWorld, from, to, zoom],
  );

  const startHandleDrag = useCallback(
    (end: 'from' | 'to', other: Endpoint) => (e: React.PointerEvent) => {
      e.stopPropagation();
      dragRef.current = { end, other };
      const onUp = (up: PointerEvent): void => {
        window.removeEventListener('pointerup', onUp);
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || !clientToWorld) return;
        const p = clientToWorld(up.clientX, up.clientY);
        const hit = topmostUnder(rects, snapshot, p);
        const oppositeId = drag.other.kind === 'attached' ? drag.other.objectId : null;
        undo?.boundary();
        try {
          if (hit && hit.id !== oppositeId) {
            setConnectorEndpoint(doc, conn.id, drag.end, {
              kind: 'attached',
              objectId: hit.id,
              fallback: { x: p.x, y: p.y },
            });
          } else if (!hit) {
            setConnectorEndpoint(doc, conn.id, drag.end, { kind: 'free', x: p.x, y: p.y });
          }
          // hit on the opposite end's own object: refused, no write (TC-13).
        } finally {
          undo?.boundary();
        }
      };
      window.addEventListener('pointerup', onUp);
    },
    [clientToWorld, conn.id, doc, rects, snapshot, undo],
  );

  return (
    <div
      role="group"
      aria-label="Connector"
      data-testid="connector-object"
      data-connector-id={conn.id}
      data-selected={selected ? 'true' : 'false'}
      className="connector-object"
      style={
        {
          left: bbox.x,
          top: bbox.y,
          width: w,
          height: h,
          zIndex: conn.z,
        } as React.CSSProperties
      }
    >
      <svg
        className="connector-object-svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        {/* Invisible wide stroke: precise near-line hit target. */}
        <line
          data-testid="connector-hit"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => {
            if (!nearLine(e)) return; // far clicks pass through to the board
            e.stopPropagation();
            onObjectPointerDown(e, conn.id);
          }}
        />
        <line
          data-testid="connector-line"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke="var(--connector-stroke, #37352f)"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
        <polygon
          data-testid="connector-arrowhead"
          points={head}
          fill="var(--connector-stroke, #37352f)"
          style={{ pointerEvents: 'none' }}
        />
        {selected ? (
          <>
            <circle
              data-testid="connector-handle-from"
              cx={fx}
              cy={fy}
              r={handleR}
              className="connector-handle"
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('from', conn.to)}
            />
            <circle
              data-testid="connector-handle-to"
              cx={tx}
              cy={ty}
              r={handleR}
              className="connector-handle"
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('to', conn.from)}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}
