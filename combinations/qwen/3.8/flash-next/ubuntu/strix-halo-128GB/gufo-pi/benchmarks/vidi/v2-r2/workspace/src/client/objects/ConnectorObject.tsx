import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnap } from '@shared/objects/connector';
import { resolveEndpoints } from '@shared/geometry/connector-geometry';
import type { Rect } from '@shared/geometry';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '@shared/config';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  camera: { x: number; y: number; zoom: number };
  onHandlePointerDown?(e: PointerEvent, id: string, end: 'from' | 'to'): void;
}

export function ConnectorObject({
  connector,
  rects,
  doc: _doc,
  zoom,
  selected,
  camera: _camera,
  onHandlePointerDown,
}: ConnectorObjectProps): ReactElement {
  const resolved = resolveEndpoints({ from: connector.from, to: connector.to }, rects);
  const { from, to } = resolved;

  // Compute the arrowhead direction
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = len > 0 ? dx / len : 0;
  const uy = len > 0 ? dy / len : 0;

  // Arrowhead triangle vertices at the end point
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const ax1 = to.x - arrowSize * ux + arrowSize * 0.4 * uy;
  const ay1 = to.y - arrowSize * uy - arrowSize * 0.4 * ux;
  const ax2 = to.x - arrowSize * ux - arrowSize * 0.4 * uy;
  const ay2 = to.y - arrowSize * uy + arrowSize * 0.4 * ux;

  // Line endpoint shortened by arrowhead
  const lineEndX = to.x - arrowSize * ux;
  const lineEndY = to.y - arrowSize * uy;

  const handleRadius = 5 / zoom; // constant screen size

  return (
    <g
      data-testid={`connector-object-${connector.id}`}
      data-object-id={connector.id}
      className="connector-object"
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={lineEndX}
        y2={lineEndY}
        stroke="#263238"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        data-testid={`connector-line-${connector.id}`}
      />
      <polygon
        points={`${to.x},${to.y} ${ax1},${ay1} ${ax2},${ay2}`}
        fill="#263238"
        data-testid={`connector-arrow-${connector.id}`}
      />
      {selected && (
        <>
          <circle
            cx={from.x}
            cy={from.y}
            r={handleRadius}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            data-testid={`connector-handle-from-${connector.id}`}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const native = e.nativeEvent as unknown as PointerEvent;
              onHandlePointerDown?.(native, connector.id, 'from');
            }}
          />
          <circle
            cx={to.x}
            cy={to.y}
            r={handleRadius}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            data-testid={`connector-handle-to-${connector.id}`}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const native = e.nativeEvent as unknown as PointerEvent;
              onHandlePointerDown?.(native, connector.id, 'to');
            }}
          />
        </>
      )}
    </g>
  );
}
