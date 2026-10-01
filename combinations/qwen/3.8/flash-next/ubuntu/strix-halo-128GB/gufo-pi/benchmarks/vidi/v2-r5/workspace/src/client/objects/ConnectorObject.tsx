import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';

/**
 * ConnectorObject: renders an SVG line with arrowhead between two resolved endpoints.
 * When selected, shows two draggable end handles for re-attaching.
 */
export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  onSelect(id: string): void;
  onToggle(id: string): void;
  canEdit: boolean;
  onHandleReattach?(id: string, end: 'from' | 'to', point: Point): void;
}

export function ConnectorObject({
  connector,
  rects,
  selected,
  zoom,
  onSelect,
  onToggle,
  canEdit,
  onHandleReattach,
}: ConnectorObjectProps) {
  const dragState = useRef<{ end: 'from' | 'to'; startX: number; startY: number; dragging: boolean } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ end: 'from' | 'to'; point: Point } | null>(null);

  const resolved = resolveEndpoints(
    { from: connector.from, to: connector.to },
    rects,
  );

  const from = dragEnd?.end === 'from' ? dragEnd.point : resolved.from;
  const to = dragEnd?.end === 'to' ? dragEnd.point : resolved.to;

  // Compute bbox for SVG positioning
  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD + 10;
  const svgX = Math.min(from.x, to.x) - pad;
  const svgY = Math.min(from.y, to.y) - pad;
  const svgW = Math.abs(to.x - from.x) + pad * 2;
  const svgH = Math.abs(to.y - from.y) + pad * 2;

  // Points relative to SVG origin
  const fx = from.x - svgX;
  const fy = from.y - svgY;
  const tx = to.x - svgX;
  const ty = to.y - svgY;

  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const angle = Math.atan2(ty - fy, tx - fx);
  const headLen = arrowSize;
  const headAngle = Math.PI / 6; // 30 degrees

  const arrowPoints = [
    `${tx},${ty}`,
    `${tx - headLen * Math.cos(angle - headAngle)},${ty - headLen * Math.sin(angle - headAngle)}`,
    `${tx - headLen * Math.cos(angle + headAngle)},${ty - headLen * Math.sin(angle + headAngle)}`,
  ].join(' ');

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      onToggle(connector.id);
    } else {
      onSelect(connector.id);
    }
  }, [connector.id, onSelect, onToggle]);

  const handleEndPointerDown = useCallback((e: ReactPointerEvent, end: 'from' | 'to') => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) return;
    dragState.current = { end, startX: e.clientX, startY: e.clientY, dragging: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [canEdit]);

  const handleEndPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!dragState.current) return;
    dragState.current.dragging = true;
    // Convert screen coords to world coords
    const target = (e.currentTarget as Element);
    const rect = target.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / zoom + svgX;
    const worldY = (e.clientY - rect.top) / zoom + svgY;
    setDragEnd({ end: dragState.current.end, point: { x: worldX, y: worldY } });
  }, [zoom, svgX, svgY]);

  const handleEndPointerUp = useCallback((_e: ReactPointerEvent) => {
    if (!dragState.current) return;
    const { end, dragging } = dragState.current;
    dragState.current = null;
    if (!dragging) {
      setDragEnd(null);
      return;
    }
    if (dragEnd && onHandleReattach) {
      onHandleReattach(connector.id, end, dragEnd.point);
    }
    setDragEnd(null);
  }, [dragEnd, onHandleReattach, connector.id]);

  const handleSize = 8 / zoom; // Constant screen size

  return (
    <div
      data-testid="connector-object"
      data-connector-id={connector.id}
      style={{
        position: 'absolute',
        left: svgX,
        top: svgY,
        width: svgW,
        height: svgH,
        pointerEvents: 'none',
      }}
      onPointerDown={handlePointerDown}
    >
      <svg
        width={svgW}
        height={svgH}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        onPointerMove={handleEndPointerMove}
        onPointerUp={handleEndPointerUp}
        aria-label={`Arrow${connector.from.kind === 'attached' ? ' from shape' : ''}${connector.to.kind === 'attached' ? ' to shape' : ''}`}
      >
        {/* Invisible thick stroke for hit area */}
        <line
          x1={fx} y1={fy} x2={tx} y2={ty}
          stroke="transparent"
          strokeWidth={12 / zoom}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        />
        {/* Visible line */}
        <line
          x1={fx} y1={fy} x2={tx} y2={ty}
          stroke="#263238"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          style={{ pointerEvents: 'none' }}
        />
        {/* Arrowhead */}
        <polygon
          points={arrowPoints}
          fill="#263238"
          style={{ pointerEvents: 'none' }}
        />
        {/* End handles when selected */}
        {selected && canEdit && (
          <>
            <circle
              cx={fx} cy={fy} r={handleSize}
              fill="#1E88E5" stroke="#fff" strokeWidth={1 / zoom}
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
              onPointerDown={(ev) => handleEndPointerDown(ev, 'from')}
              data-testid="connector-handle-from"
            />
            <circle
              cx={tx} cy={ty} r={handleSize}
              fill="#1E88E5" stroke="#fff" strokeWidth={1 / zoom}
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
              onPointerDown={(ev) => handleEndPointerDown(ev, 'to')}
              data-testid="connector-handle-to"
            />
          </>
        )}
      </svg>
    </div>
  );
}
