/**
 * ConnectorObject (story 10): SVG line with arrowhead, end handles for re-attach.
 */
import React, { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { Endpoint } from '../../shared/objects/connector';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import type { Point, Rect } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  /** Callback for hit-testing a world point against this connector. */
  onHitTest?(id: string, worldPoint: Point): void;
}

export function ConnectorObject({ connector, rects, doc, selected, zoom }: ConnectorObjectProps) {
  const resolved = resolveEndpoints(connector as any, rects);
  const { from, to } = resolved;

  // Compute arrowhead
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const headSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;

  // Arrowhead polygon points (triangle at the 'to' end)
  const ax1 = to.x - headSize * Math.cos(angle - Math.PI / 6);
  const ay1 = to.y - headSize * Math.sin(angle - Math.PI / 6);
  const ax2 = to.x - headSize * Math.cos(angle + Math.PI / 6);
  const ay2 = to.y - headSize * Math.sin(angle + Math.PI / 6);

  // Bounding box for SVG element
  const svgX = Math.min(from.x, to.x, ax1, ax2) - 2;
  const svgY = Math.min(from.y, to.y, ay1, ay2) - 2;
  const svgW = Math.max(from.x, to.x, ax1, ax2) - svgX + 4;
  const svgH = Math.max(from.y, to.y, ay1, ay2) - svgY + 4;

  // Adjust line endpoint so arrowhead sits at the tip
  const lineToX = to.x - headSize * 0.7 * Math.cos(angle);
  const lineToY = to.y - headSize * 0.7 * Math.sin(angle);

  const handleSize = 8 / zoom; // handle size in world units so it appears constant on screen

  return (
    <div
      data-connector-id={connector.id}
      data-testid="connector-object"
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: svgX,
        top: svgY,
        width: svgW,
        height: svgH,
        pointerEvents: 'none',
      }}
      role="img"
      aria-label="Connector arrow"
    >
      <svg
        width={svgW}
        height={svgH}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {/* Line */}
        <line
          x1={from.x - svgX}
          y1={from.y - svgY}
          x2={lineToX - svgX}
          y2={lineToY - svgY}
          stroke="#263238"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        {/* Arrowhead */}
        <polygon
          points={`${to.x - svgX},${to.y - svgY} ${ax1 - svgX},${ay1 - svgY} ${ax2 - svgX},${ay2 - svgY}`}
          fill="#263238"
        />
        {/* End handles when selected */}
        {selected && (
          <>
            <circle
              cx={from.x - svgX}
              cy={from.y - svgY}
              r={handleSize}
              fill="#fff"
              stroke="#1976D2"
              strokeWidth={1.5 / zoom}
              data-testid="connector-handle-from"
              style={{ pointerEvents: 'all', cursor: 'move' }}
            />
            <circle
              cx={to.x - svgX}
              cy={to.y - svgY}
              r={handleSize}
              fill="#fff"
              stroke="#1976D2"
              strokeWidth={1.5 / zoom}
              data-testid="connector-handle-to"
              style={{ pointerEvents: 'all', cursor: 'move' }}
            />
          </>
        )}
      </svg>
    </div>
  );
}
