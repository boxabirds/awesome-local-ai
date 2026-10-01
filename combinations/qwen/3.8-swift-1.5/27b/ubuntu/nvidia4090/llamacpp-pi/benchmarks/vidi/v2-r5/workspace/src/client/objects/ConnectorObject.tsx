// src/client/objects/ConnectorObject.tsx
// SVG line with arrowhead, end handles for re-attach when selected.

import { useState, useCallback } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { resolveEndpoints, type Endpoint } from '../../shared/geometry/connector-geometry';
import type { Rect, Point } from '../../shared/geometry';

export interface ConnectorSnap {
  id: string;
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  z: number;
}

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  /** Re-attach an endpoint. Returns true on success. */
  setEndpoint: (id: string, end: 'from' | 'to', ep: Endpoint) => boolean;
  /** Hit test the objects at a world point. Returns the object id or null. */
  hitTestObject: (worldPoint: Point) => string | null;
}

export function ConnectorObject(props: ConnectorObjectProps): ReactElement {
  const { connector, rects, selected, zoom, onPointerDown, setEndpoint, hitTestObject } = props;
  const [draggingEnd, setDraggingEnd] = useState<'from' | 'to' | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  const { from, to } = resolveEndpoints(connector as any, rects);

  // If dragging an end, use the drag position for that end
  const displayFrom = draggingEnd === 'from' && dragPos ? dragPos : from;
  const displayTo = draggingEnd === 'to' && dragPos ? dragPos : to;

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    onPointerDown(e, connector.id);
  }, [connector.id, onPointerDown]);

  // Handle end-drag start
  const handleEndPointerDown = useCallback((e: ReactPointerEvent, end: 'from' | 'to') => {
    if (!selected) return;
    e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    setDraggingEnd(end);

    const svg = (e.currentTarget as SVGElement).closest('svg');
    if (svg) {
      const rect = svg.getBoundingClientRect();
      setDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, [selected]);

  // Handle end-drag move
  const handleEndPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!draggingEnd) return;
    const svg = (e.currentTarget as SVGElement).closest('svg');
    if (svg) {
      const rect = svg.getBoundingClientRect();
      setDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, [draggingEnd]);

  // Handle end-drag release
  const handleEndPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!draggingEnd) return;
    try {
      (e.currentTarget as SVGElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }

    const svg = (e.currentTarget as SVGElement).closest('svg');
    if (svg && dragPos) {
      // Convert screen to world (approximate: the SVG is in world space)
      // The SVG element is inside the world-transformed div, so coordinates are world
      const worldPoint: Point = { x: dragPos.x, y: dragPos.y };
      const targetObjId = hitTestObject(worldPoint);

      if (targetObjId) {
        // Check: not the opposite end's object
        const oppositeEnd = draggingEnd === 'from' ? 'to' : 'from';
        const oppositeEp = connector[oppositeEnd];
        if (oppositeEp.kind === 'attached' && oppositeEp.objectId === targetObjId) {
          // Rejected: snap back
          setDraggingEnd(null);
          setDragPos(null);
          return;
        }
        setEndpoint(connector.id, draggingEnd, { kind: 'attached', objectId: targetObjId, fallback: worldPoint });
      } else {
        // Free endpoint
        setEndpoint(connector.id, draggingEnd, { kind: 'free', x: worldPoint.x, y: worldPoint.y });
      }
    }

    setDraggingEnd(null);
    setDragPos(null);
  }, [draggingEnd, dragPos, connector, hitTestObject, setEndpoint]);

  // Arrowhead computation
  const angle = Math.atan2(displayTo.y - displayFrom.y, displayTo.x - displayFrom.x);
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const arrowAngle = Math.PI / 6; // 30 degrees

  const arrowX1 = displayTo.x - arrowSize * Math.cos(angle - arrowAngle);
  const arrowY1 = displayTo.y - arrowSize * Math.sin(angle - arrowAngle);
  const arrowX2 = displayTo.x - arrowSize * Math.cos(angle + arrowAngle);
  const arrowY2 = displayTo.y - arrowSize * Math.sin(angle + arrowAngle);

  return (
    <g
      data-testid="connector-object"
      role="group"
      aria-label="Connector arrow"
      onPointerDown={handlePointerDown}
      style={{ cursor: 'pointer' }}
    >
      {/* Invisible fat line for hit testing */}
      <line
        x1={displayFrom.x}
        y1={displayFrom.y}
        x2={displayTo.x}
        y2={displayTo.y}
        stroke="transparent"
        strokeWidth={CONNECTOR_HIT_TOLERANCE_PX * 2}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Visible line */}
      <line
        x1={displayFrom.x}
        y1={displayFrom.y}
        x2={displayTo.x}
        y2={displayTo.y}
        stroke={selected ? '#1E88E5' : '#263238'}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        style={{ pointerEvents: 'none' }}
      />

      {/* Arrowhead */}
      <polygon
        points={`${displayTo.x},${displayTo.y} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`}
        fill={selected ? '#1E88E5' : '#263238'}
        style={{ pointerEvents: 'none' }}
      />

      {/* End handles (when selected) */}
      {selected && (
        <>
          <circle
            data-testid="connector-handle-from"
            cx={displayFrom.x}
            cy={displayFrom.y}
            r={6 / zoom}
            fill="white"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => handleEndPointerDown(e, 'from')}
            onPointerMove={handleEndPointerMove}
            onPointerUp={handleEndPointerUp}
          />
          <circle
            data-testid="connector-handle-to"
            cx={displayTo.x}
            cy={displayTo.y}
            r={6 / zoom}
            fill="white"
            stroke="#1E88E5"
            strokeWidth={2 / zoom}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => handleEndPointerDown(e, 'to')}
            onPointerMove={handleEndPointerMove}
            onPointerUp={handleEndPointerUp}
          />
        </>
      )}
    </g>
  );
}
