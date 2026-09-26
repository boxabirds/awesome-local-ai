/**
 * Connector object renderer (story 10).
 *
 * Renders SVG line with arrowhead, and end handles when selected.
 */
import { type JSX } from 'react';
import * as Y from 'yjs';
import type { ConnectorSnap } from '../../shared/geometry/connector-geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import { CONNECTOR_STROKE_WIDTH_WORLD, CONNECTOR_ARROWHEAD_SIZE_WORLD } from '../../shared/config';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element | null {
  const { connector, rects, selected, zoom } = props;

  // Resolve endpoints from live rects.
  const { from, to } = resolveEndpoints(connector, rects);

  const strokeW = CONNECTOR_STROKE_WIDTH_WORLD;
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;

  // Arrowhead direction.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.1) return null;

  // Arrow tip geometry.
  const angle = Math.atan2(dy, dx);
  const tipX = to.x;
  const tipY = to.y;
  const baseX = tipX - arrowSize * Math.cos(angle - Math.PI / 6);
  const baseY = tipY - arrowSize * Math.sin(angle - Math.PI / 6);
  const base2X = tipX - arrowSize * Math.cos(angle + Math.PI / 6);
  const base2Y = tipY - arrowSize * Math.sin(angle + Math.PI / 6);

  // Compute SVG bounding box in world coords.
  const pad = arrowSize + strokeW;
  const svgX = Math.min(from.x, to.x) - pad;
  const svgY = Math.min(from.y, to.y) - pad;
  const svgW = Math.abs(to.x - from.x) + pad * 2;
  const svgH = Math.abs(to.y - from.y) + pad * 2;

  // Local coordinates.
  const lx1 = from.x - svgX;
  const ly1 = from.y - svgY;
  const lx2 = to.x - svgX;
  const ly2 = to.y - svgY;
  const lbx1 = baseX - svgX;
  const lby1 = baseY - svgY;
  const lbx2 = base2X - svgX;
  const lby2 = base2Y - svgY;

  return (
    <div
      data-testid="connector-object"
      data-board-object="connector"
      data-connector-id={connector.id}
      style={{
        position: 'absolute',
        left: svgX,
        top: svgY,
        width: svgW,
        height: svgH,
        pointerEvents: 'none',
        zIndex: selected ? 3 : 1,
      }}
    >
      <svg
        width={svgW}
        height={svgH}
        style={{ overflow: 'visible' }}
        focusable="false"
      >
        <line
          x1={lx1}
          y1={ly1}
          x2={lx2}
          y2={ly2}
          stroke="#263238"
          strokeWidth={strokeW}
        />
        <polygon
          points={`${lx2},${ly2} ${lbx1},${lby1} ${lbx2},${lby2}`}
          fill="#263238"
        />
        {/* Start handle when selected */}
        {selected && (
          <circle cx={lx1} cy={ly1} r={4 / zoom} fill="#4FC3F7" stroke="#fff" strokeWidth={1 / zoom} />
        )}
        {/* End handle when selected */}
        {selected && (
          <circle cx={lx2} cy={ly2} r={4 / zoom} fill="#4FC3F7" stroke="#fff" strokeWidth={1 / zoom} />
        )}
      </svg>
    </div>
  );
}
