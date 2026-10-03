// Connector object component: SVG line with arrowhead and end handles (story 10).

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';
import {
  resolveEndpoints,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Point, Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { ObjectProps } from './registry';

interface ConnectorSnap {
  id: string;
  from: Endpoint;
  to: Endpoint;
}

/** Build a rects map from the snapshot for endpoint resolution. */
function buildRectsMap(snapshot: readonly ObjectSnapshot[]): Map<string, Rect> {
  const map = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    map.set(obj.id, objectBounds(obj));
  }
  return map;
}

/** Hit test: is the world point within tolerance of the connector line? */
function hitTestConnector(conn: ConnectorSnap, rects: Map<string, Rect>, p: Point, zoom: number): boolean {
  const { from, to } = resolveEndpoints(conn, rects);
  const dist = distanceToPolyline([from, to], p);
  return dist <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

export function ConnectorObject({
  obj,
  doc,
  zoom,
  selected,
  editing,
  onObjectPointerDown,
  onObjectDoubleClick,
  onEndEdit,
  onBoundary,
  onUndo,
  onRedo,
}: ObjectProps) {
  // We need the snapshot to build the rects map. Since we don't have direct
  // access to it, we'll use the doc to resolve endpoints.
  const conn = obj as ObjectSnapshot & { from: Endpoint; to: Endpoint };
  const rects = buildRectsFromDoc(doc);
  const { from, to } = resolveEndpoints(conn as ConnectorSnap, rects);

  const handlePointerDown = (e: ReactPointerEvent<Element>) => {
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  };

  // Convert to screen coordinates for rendering
  const fromScreen = { x: (from.x * zoom), y: (from.y * zoom) };
  const toScreen = { x: (to.x * zoom), y: (to.y * zoom) };

  // Arrowhead calculation
  const angle = Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
  const headSize = CONNECTOR_ARROWHEAD_SIZE_WORLD * zoom;
  const headAngle = Math.PI / 6; // 30 degrees

  const headX1 = toScreen.x - headSize * Math.cos(angle - headAngle);
  const headY1 = toScreen.y - headSize * Math.sin(angle - headAngle);
  const headX2 = toScreen.x - headSize * Math.cos(angle + headAngle);
  const headY2 = toScreen.y - headSize * Math.sin(angle + headAngle);

  // Selection box (bounding box of the line)
  const minX = Math.min(fromScreen.x, toScreen.x);
  const minY = Math.min(fromScreen.y, toScreen.y);
  const maxW = Math.abs(toScreen.x - fromScreen.x);
  const maxH = Math.abs(toScreen.y - fromScreen.y);

  // End handles (when selected)
  const [draggingEnd, setDraggingEnd] = useState<'from' | 'to' | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  const handleEndPointerDown = (end: 'from' | 'to') => (e: ReactPointerEvent<Element>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraggingEnd(end);
  };

  const handleEndPointerMove = (e: ReactPointerEvent<Element>) => {
    if (!draggingEnd) return;
    e.stopPropagation();
    // We need the camera to convert screen to world, but we don't have it here.
    // The handle dragging is handled at a higher level for now.
  };

  const handleEndPointerUp = (e: ReactPointerEvent<Element>) => {
    if (!draggingEnd) return;
    e.stopPropagation();
    setDraggingEnd(null);
    setDragPos(null);
  };

  return (
    <div
      role="group"
      aria-label="Connector arrow"
      data-testid="connector-object"
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        width={1}
        height={1}
        style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0 }}
      >
        {/* Line */}
        <line
          x1={fromScreen.x}
          y1={fromScreen.y}
          x2={toScreen.x}
          y2={toScreen.y}
          stroke={selected ? '#1976D2' : '#263238'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * zoom}
          pointerEvents="stroke"
          style={{ cursor: selected ? 'default' : 'pointer' }}
          onPointerDown={handlePointerDown}
        />
        {/* Arrowhead */}
        <polygon
          points={`${toScreen.x},${toScreen.y} ${headX1},${headY1} ${headX2},${headY2}`}
          fill={selected ? '#1976D2' : '#263238'}
          pointerEvents="none"
        />
        {/* Selection highlight */}
        {selected && (
          <line
            x1={fromScreen.x}
            y1={fromScreen.y}
            x2={toScreen.x}
            y2={toScreen.y}
            stroke="rgba(25,118,210,0.2)"
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * zoom + 4}
            pointerEvents="none"
          />
        )}
        {/* End handles (when selected) */}
        {selected && (
          <>
            <circle
              data-testid="connector-handle-from"
              cx={fromScreen.x}
              cy={fromScreen.y}
              r={6}
              fill="white"
              stroke="#1976D2"
              strokeWidth={2}
              pointerEvents="auto"
              style={{ cursor: 'move' }}
              onPointerDown={handleEndPointerDown('from')}
              onPointerMove={handleEndPointerMove}
              onPointerUp={handleEndPointerUp}
            />
            <circle
              data-testid="connector-handle-to"
              cx={toScreen.x}
              cy={toScreen.y}
              r={6}
              fill="white"
              stroke="#1976D2"
              strokeWidth={2}
              pointerEvents="auto"
              style={{ cursor: 'move' }}
              onPointerDown={handleEndPointerDown('to')}
              onPointerMove={handleEndPointerMove}
              onPointerUp={handleEndPointerUp}
            />
          </>
        )}
      </svg>
    </div>
  );
}

/** Build a rects map from the Y.Doc (for endpoint resolution). */
function buildRectsFromDoc(doc: Y.Doc): Map<string, Rect> {
  const map = new Map<string, Rect>();
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  objects.forEach((obj, id) => {
    const type = obj.get('type');
    if (type === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const w = obj.get('width');
    const h = obj.get('height');
    if (typeof x === 'number' && typeof y === 'number') {
      map.set(id, {
        x,
        y,
        width: typeof w === 'number' ? w : 200,
        height: typeof h === 'number' ? h : 200,
      });
    }
  });
  return map;
}
