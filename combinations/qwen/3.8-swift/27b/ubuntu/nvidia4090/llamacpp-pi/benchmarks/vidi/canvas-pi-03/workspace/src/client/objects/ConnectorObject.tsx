/**
 * Story 10: the connector (arrow) board object (connector.ui).
 *
 * Rendered inside the world layer's SVG (which scales uniformly), so arrows
 * follow object moves by anyone for free: a straight line from the resolved
 * `from` anchor to the resolved `to` anchor (world coordinates, computed in
 * `allObjects`) with a filled triangular arrowhead
 * (CONNECTOR_ARROWHEAD_SIZE_WORLD) at the `to` end. The stroke is
 * CONNECTOR_STROKE_WIDTH_WORLD board units, so its width scales with the
 * world layer (at any zoom).
 *
 * Interaction (story 10's only object-level behaviours):
 * - clicking within CONNECTOR_HIT_TOLERANCE_PX of the line selects it — the
 *   SVG line carries a WIDE invisible hit stroke (the tolerance, constant in
 *   screen px at any zoom) so a real browser's DOM event lands on it; the
 *   board additionally hit-tests the polyline in world units, covering the
 *   empty-click path and jsdom component tests;
 * - both ends show a circular handle (constant screen size
 *   CONNECTOR_DOT_RADIUS_PX);
 * - dragging a handle (while selected) re-attaches it — over an object →
 *   attached, over empty space → free — one `setConnectorEndpoint` per
 *   release inside an undo boundary (the model rejects a re-attach onto the
 *   opposite end's object);
 * - Delete/Backspace removes it with the generic selection machinery.
 *
 * Accessibility: announced as "Arrow from A to B" (labels are object names
 * — the ids stand in until the label story).
 */
import { useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from 'src/shared/config';
import {
  sideAnchor,
  nearestSide,
  type Endpoint,
} from 'src/shared/geometry/connector-geometry';
import { setConnectorEndpoint } from 'src/shared/objects/connector';
import { objectsOf } from 'src/shared/board-model';
import type { ObjectProps } from './registry';

interface HandleDrag {
  end: 'from' | 'to';
}

/** The topmost non-connector object near a world point (handle tolerance). */
function findTarget(
  doc: Y.Doc,
  world: { x: number; y: number },
  zoom: number,
): { id: string; rect: { x: number; y: number; width: number; height: number } } | null {
  const tol = CONNECTOR_DOT_RADIUS_PX / Math.max(zoom, 0.01);
  let best: { id: string; rect: { x: number; y: number; width: number; height: number } } | null = null;
  let bestZ = -Infinity;
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    if (obj.get('type') === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const w = (obj.get('width') as number) ?? 0;
    const h = (obj.get('height') as number) ?? 0;
    const near =
      world.x >= x - tol && world.x <= x + w + tol && world.y >= y - tol && world.y <= y + h + tol;
    if (!near) return;
    const z = (obj.get('z') as number) ?? 0;
    if (z >= bestZ) {
      bestZ = z;
      best = { id: key as string, rect: { x, y, width: w, height: h } };
    }
  });
  return best;
}

export interface ConnectorObjectProps extends ObjectProps {
  camera: Camera;
  /** The board's identity id (createdBy). */
  identity: string;
  /** Keeps the board in sync after a re-attach (the derived bbox changed). */
  onEndsChanged(): void;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { obj, selected, camera, doc, undo, onEndsChanged } = props;
  const groupRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<HandleDrag | null>(null);

  const ends = obj.ends;
  if (!ends) {
    // Malformed connector: nothing to draw.
    return <g data-testid="connector-object" data-connector-id={obj.id} />;
  }

  const from = ends.from;
  const to = ends.to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  const ah = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const base = { x: to.x - ux * ah, y: to.y - uy * ah };
  const px = -uy;
  const py = ux;
  const headW = ah / 2;
  const arrowPath = `M ${to.x} ${to.y} L ${base.x + px * headW} ${base.y + py * headW} L ${base.x - px * headW} ${base.y - py * headW} Z`;

  const zoom = Math.max(camera.zoom, 0.01);
  // Screen-constant sizes expressed in world units at the current zoom.
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom;
  const handleR = CONNECTOR_DOT_RADIUS_PX / zoom;
  const lineW = Math.max(CONNECTOR_STROKE_WIDTH_WORLD, 1 / zoom);

  const handleDown = (end: 'from' | 'to') => (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    groupRef.current?.setPointerCapture(e.pointerId);
    setDrag({ end });
  };

  const handleUp = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!drag) return;
    if (groupRef.current && groupRef.current.hasPointerCapture(e.pointerId)) {
      groupRef.current.releasePointerCapture(e.pointerId);
    }
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const end = drag.end;
    setDrag(null);
    const t = findTarget(doc, world, zoom);
    const next: Endpoint = t
      ? { kind: 'attached', objectId: t.id, fallback: sideAnchor(t.rect, nearestSide(t.rect, world)) }
      : { kind: 'free', x: world.x, y: world.y };
    // Story 8: one re-attach is exactly one undo step (the model rejects a
    // re-attach onto the object at the opposite end).
    undo.boundary();
    setConnectorEndpoint(doc, obj.id, end, next);
    undo.boundary();
    onEndsChanged();
  };

  const handleCancel = (e: React.PointerEvent<SVGCircleElement>) => {
    if (groupRef.current && groupRef.current.hasPointerCapture(e.pointerId)) {
      groupRef.current.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
  };

  // A standalone SVG positioned at the world origin inside the (scaled)
  // world layer: its coordinate system starts at (0,0), so world-unit
  // coordinates work as-is and the whole arrow scales with the world layer.
  return (
    <svg
      ref={groupRef}
      data-testid="connector-object"
      data-connector-id={obj.id}
      data-selected={selected || undefined}
      role="img"
      aria-label={`Arrow from ${obj.id.slice(0, 8)} to ${obj.id.slice(0, 8)}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {/* Wide invisible hit stroke: a real browser's DOM click selects
          the arrow within the tolerance at any zoom. */}
      <line
        data-testid="connector-line"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={Math.max(hitWidth, lineW)}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          props.onSelect(obj.id);
        }}
      />
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#263238"
        strokeWidth={lineW}
      />
      <path d={arrowPath} fill="#263238" />
      {(['from', 'to'] as const).map((end) => {
        const p = end === 'from' ? from : to;
        return (
          <circle
            key={end}
            data-testid={`connector-handle-${end}`}
            cx={p.x}
            cy={p.y}
            r={handleR}
            fill="#FFFFFF"
            stroke="#1A73E8"
            strokeWidth={2 / zoom}
            style={{ cursor: 'crosshair', pointerEvents: selected ? 'all' : 'none' }}
            onPointerDown={handleDown(end)}
            onPointerUp={handleUp}
            onPointerCancel={handleCancel}
          />
        );
      })}
    </svg>
  );
}

