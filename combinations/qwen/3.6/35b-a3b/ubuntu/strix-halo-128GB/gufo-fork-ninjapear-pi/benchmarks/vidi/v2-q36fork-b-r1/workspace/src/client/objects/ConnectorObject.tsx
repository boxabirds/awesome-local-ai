import { useState, useCallback, useRef, type ReactNode } from 'react';
import * as Y from 'yjs';
import { objectBounds } from '@/shared/board-model';
import { resolveEndpoints, connectorBBox, distanceToPolyline, distanceToSegment } from '@/shared/geometry/connector-geometry';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD, CONNECTOR_ARROWHEAD_SIZE_WORLD } from '@/shared/config';
import { setConnectorEndpoint } from '@/shared/objects/connector';
import type { ObjectSnapshot as ObjectSnap } from './registry';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, CONNECTOR_DOT_RADIUS_PX } from '@/shared/config';

interface ConnectorObjectProps {
  connector: ObjectSnap & { type: 'connector'; from: Endpoint; to: Endpoint };
  rects: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
}

interface Endpoint {
  kind: 'attached' | 'free';
  objectId?: string;
  fallback?: { x: number; y: number };
  x?: number;
  y?: number;
}

/** Renders a connector (arrow) with optional end-handle for re-attaching. */
export function ConnectorObject(props: ConnectorObjectProps): ReactNode {
  const { connector, rects, doc, zoom, selected, editing: _editing, onSelect, onStartEdit: _onStartEdit, onEndEdit: _onEndEdit, onObjectPointerDown } = props;

  // Resolve endpoints from live rects
  const connectorEndpoints = { from: connector.from as import('@/shared/geometry/connector-geometry').Endpoint, to: connector.to as import('@/shared/geometry/connector-geometry').Endpoint };
  const endpoints = resolveEndpoints(connectorEndpoints, rects);
  const bbox = connectorBBox(endpoints.from, endpoints.to);

  const handleSizePx = 6 / zoom;
  const strokeWidth = CONNECTOR_STROKE_WIDTH_WORLD / zoom;
  const arrowheadSize = CONNECTOR_ARROWHEAD_SIZE_WORLD / zoom;

  // Line segment coordinates
  const linePath = `${endpoints.from.x},${endpoints.from.y} ${endpoints.to.x},${endpoints.to.y}`;

  // Arrowhead - draw triangle at the end point pointing back along the line
  const dx = endpoints.to.x - endpoints.from.x;
  const dy = endpoints.to.y - endpoints.from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;

  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;

  const arrowPoints = [
    `${endpoints.to.x},${endpoints.to.y}`,
    `${endpoints.to.x - ux * arrowheadSize + perpX * arrowheadSize * 0.4},${endpoints.to.y - uy * arrowheadSize + perpY * arrowheadSize * 0.4}`,
    `${endpoints.to.x - ux * arrowheadSize - perpX * arrowheadSize * 0.4},${endpoints.to.y - uy * arrowheadSize - perpY * arrowheadSize * 0.4}`,
  ].join(' ');

  // End handles when selected
  const handles: ReactNode[] = [];
  if (selected) {
    handles.push(
      <circle
        key="handle-from"
        data-testid={`connector-handle-from-${connector.id}`}
        cx={endpoints.from.x}
        cy={endpoints.from.y}
        r={handleSizePx}
        fill="#fff"
        stroke="#2979ff"
        strokeWidth={2 / zoom}
        style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
        onPointerDown={(e: React.PointerEvent) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
      />,
      <circle
        key="handle-to"
        data-testid={`connector-handle-to-${connector.id}`}
        cx={endpoints.to.x}
        cy={endpoints.to.y}
        r={handleSizePx}
        fill="#fff"
        stroke="#2979ff"
        strokeWidth={2 / zoom}
        style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
        onPointerDown={(e: React.PointerEvent) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
      />,
    );
  }

  return (
    <g
      data-testid={`connector-${connector.id}`}
      // Arrow line and arrowhead rendered in world space relative to BoardViewport's transform
    >
      {/* Invisible hit area — wide enough for selection */}
      <line
        x1={endpoints.from.x}
        y1={endpoints.from.y}
        x2={endpoints.to.x}
        y2={endpoints.to.y}
        stroke="transparent"
        strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX * 3) / zoom}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onSelect(connector.id);
        }}
      />
      {/* Visible line */}
      <line
        x1={endpoints.from.x}
        y1={endpoints.from.y}
        x2={endpoints.to.x}
        y2={endpoints.to.y}
        stroke="#666"
        strokeWidth={strokeWidth}
      />
      {/* Arrowhead */}
      <polygon points={arrowPoints} fill="#666" />
      {/* End handles */}
      {handles}
    </g>
  );
}
