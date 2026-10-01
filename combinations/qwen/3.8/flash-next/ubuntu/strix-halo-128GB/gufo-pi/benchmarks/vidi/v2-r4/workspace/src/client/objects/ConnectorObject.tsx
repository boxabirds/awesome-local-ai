/**
 * ConnectorObject: renders an SVG line with arrowhead between two resolved
 * endpoints. Shows end handles when selected for re-attach.
 */
import { useCallback } from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import {
  resolveEndpoints,
  nearestSide,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import type { Endpoint } from '../../shared/geometry/connector-geometry';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import type { Point } from '../canvas/camera';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  camera: { x: number; y: number; zoom: number };
  snapshot: readonly { id: string; type: string; x: number; y: number; width?: number; height?: number }[];
  onPointerDown?(e: React.PointerEvent<SVGElement>, id: string): void;
  onCreateHandleDrag?(): void;
}

export function ConnectorObject({
  connector,
  rects,
  doc,
  selected,
  zoom,
  camera,
  snapshot,
  onPointerDown: onPointerDownProp,
}: ConnectorObjectProps): React.JSX.Element {
  const resolved = resolveEndpoints(connector, rects);
  const { from, to } = resolved;

  const strokeW = CONNECTOR_STROKE_WIDTH_WORLD;
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;

  // Compute arrowhead angle
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const a1x = to.x - arrowSize * Math.cos(angle - Math.PI / 6);
  const a1y = to.y - arrowSize * Math.sin(angle - Math.PI / 6);
  const a2x = to.x - arrowSize * Math.cos(angle + Math.PI / 6);
  const a2y = to.y - arrowSize * Math.sin(angle + Math.PI / 6);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      onPointerDownProp?.(e, connector.id);
    },
    [onPointerDownProp, connector.id],
  );

  // End handle drag for re-attach
  const handleEndPointerDown = useCallback(
    (end: 'from' | 'to') => (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const el = (e.currentTarget.ownerSVGElement || e.currentTarget.closest('svg')) as SVGElement;
      if (!el) return;

      const onMove = (_ev: PointerEvent) => {
        // We just track for release; visual feedback optional
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);

        // Determine world point of release
        const svgRect = el.getBoundingClientRect();
        const screenP = { x: ev.clientX - svgRect.left, y: ev.clientY - svgRect.top };
        const world = { x: screenP.x / zoom + camera.x, y: screenP.y / zoom + camera.y };

        // Hit-test objects
        let targetId: string | null = null;
        for (let i = snapshot.length - 1; i >= 0; i--) {
          const obj = snapshot[i]!;
          if (obj.type === 'connector') continue;
          const w = obj.width ?? 200;
          const h = obj.height ?? 200;
          if (world.x >= obj.x && world.x <= obj.x + w && world.y >= obj.y && world.y <= obj.y + h) {
            targetId = obj.id;
            break;
          }
        }

        // Check if over the opposite end's object → snap back
        if (targetId) {
          const opposite = end === 'from' ? connector.to : connector.from;
          if (opposite.kind === 'attached' && opposite.objectId === targetId) {
            return; // snap back - do nothing
          }
          // Attach to target
          const targetRect = rects.get(targetId);
          let ep: Endpoint;
          if (targetRect) {
            const otherEnd = end === 'from' ? connector.to : connector.from;
            let otherPt: Point;
            if (otherEnd.kind === 'attached') {
              const or = rects.get(otherEnd.objectId);
              otherPt = or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : otherEnd.fallback;
            } else {
              otherPt = { x: otherEnd.x, y: otherEnd.y };
            }
            const side = nearestSide(targetRect, otherPt);
            const anchor = sideAnchor(targetRect, side);
            ep = { kind: 'attached', objectId: targetId, fallback: anchor };
          } else {
            ep = { kind: 'free', x: world.x, y: world.y };
          }
          setConnectorEndpoint(doc, connector.id, end, ep);
        } else {
          // Detach to free point
          setConnectorEndpoint(doc, connector.id, end, { kind: 'free', x: world.x, y: world.y });
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [connector, doc, rects, zoom, camera, snapshot],
  );

  const handleSize = HANDLE_SIZE_PX / zoom;

  return (
    <g
      data-testid={`connector-${connector.id}`}
      data-connector-id={connector.id}
      className="board-object"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#263238"
        strokeWidth={strokeW}
        onPointerDown={handlePointerDown}
        style={{ cursor: 'pointer' }}
      />
      {/* Invisible wider line for easier click targeting */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={CONNECTOR_HIT_TOLERANCE_PX_WORLD(zoom)}
        onPointerDown={handlePointerDown}
        style={{ cursor: 'pointer' }}
      />
      {/* Arrowhead */}
      <polygon
        points={`${to.x},${to.y} ${a1x},${a1y} ${a2x},${a2y}`}
        fill="#263238"
      />
      {/* End handles when selected */}
      {selected && (
        <>
          <circle
            data-testid="connector-handle-from"
            cx={from.x}
            cy={from.y}
            r={handleSize}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            style={{ cursor: 'grab' }}
            onPointerDown={handleEndPointerDown('from')}
          />
          <circle
            data-testid="connector-handle-to"
            cx={to.x}
            cy={to.y}
            r={handleSize}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            style={{ cursor: 'grab' }}
            onPointerDown={handleEndPointerDown('to')}
          />
        </>
      )}
    </g>
  );
}

function CONNECTOR_HIT_TOLERANCE_PX_WORLD(zoom: number): number {
  return 6 / zoom;
}
