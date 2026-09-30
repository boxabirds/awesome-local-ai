/**
 * Connector object renderer (story 10, connector.ui).
 *
 * Renders an SVG line with arrowhead, using resolveEndpoints for live
 * position. Shows end handles when selected for re-attach.
 */
import { useRef, useState, useCallback } from 'react';
import type { ObjectProps } from './registry';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';

interface ConnectorObjectProps extends ObjectProps {
  /** All objects in the snapshot (for resolving endpoints). */
  snapshot: readonly ObjectSnapshot[];
  onBoundary(): void;
}

export function ConnectorObject({
  obj,
  doc,
  z,
  zoom,
  selected,
  onPointerDown,
  snapshot,
  onBoundary,
}: ConnectorObjectProps & { snapshot: readonly ObjectSnapshot[]; onBoundary(): void }) {
  const connector = obj as ConnectorSnap;
  const { from, to } = connector;

  // Build rects map for endpoint resolution
  const rects = new Map<string, Rect>();
  for (const o of snapshot) {
    const b = objectBounds(o);
    rects.set(o.id, b);
  }

  const { from: fromPt, to: toPt } = resolveEndpoints({ from, to }, rects);

  // Arrowhead calculation
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const angle = Math.atan2(dy, dx);
  const arrowLen = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const arrowAngle = Math.PI / 6; // 30 degrees

  const arrowTipX = toPt.x;
  const arrowTipY = toPt.y;
  const arrowLeftX = arrowTipX - arrowLen * Math.cos(angle - arrowAngle);
  const arrowLeftY = arrowTipY - arrowLen * Math.sin(angle - arrowAngle);
  const arrowRightX = arrowTipX - arrowLen * Math.cos(angle + arrowAngle);
  const arrowRightY = arrowTipY - arrowLen * Math.sin(angle + arrowAngle);

  // End handle state
  const [draggingEnd, setDraggingEnd] = useState<'from' | 'to' | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onPointerDown(e, connector.id);
  };

  // End handle drag
  const handleEndPointerDown = useCallback((end: 'from' | 'to') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingEnd(end);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* jsdom */ }
  }, []);

  const handleEndPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingEnd) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / zoom;
    const localY = (e.clientY - rect.top) / zoom;
    setDragPos({ x: localX, y: localY });
  }, [draggingEnd, zoom]);

  const handleEndPointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingEnd || !dragPos) return;
    setDraggingEnd(null);
    setDragPos(null);

    // Hit test at the release point
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / zoom;
    const worldY = (e.clientY - rect.top) / zoom;

    // Find if we're over an object
    let targetId: string | null = null;
    for (const o of snapshot) {
      const b = objectBounds(o);
      if (worldX >= b.x && worldX < b.x + b.width && worldY >= b.y && worldY < b.y + b.height) {
        targetId = o.id;
        break;
      }
    }

    // Check: don't attach to the opposite end's object
    const opposite = draggingEnd === 'from' ? to : from;
    if (targetId && opposite.kind === 'attached' && targetId === opposite.objectId) {
      return; // snap back
    }

    const newEndpoint: Endpoint = targetId
      ? { kind: 'attached', objectId: targetId, fallback: { x: worldX, y: worldY } }
      : { kind: 'free', x: worldX, y: worldY };

    const ok = setConnectorEndpoint(doc, connector.id, draggingEnd, newEndpoint);
    if (ok) {
      onBoundary();
    }
  }, [draggingEnd, dragPos, zoom, snapshot, doc, connector.id, from, to, onBoundary]);

  return (
    <svg
      ref={svgRef}
      data-testid="connector-object"
      data-connector-id={connector.id}
      data-selected={selected || undefined}
      role="group"
      aria-label="Arrow connector"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        zIndex: z,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handleEndPointerMove}
      onPointerUp={handleEndPointerUp}
    >
      {/* Invisible thick line for hit testing (only when not selected) */}
      {!selected && (
        <line
          x1={fromPt.x}
          y1={fromPt.y}
          x2={toPt.x}
          y2={toPt.y}
          stroke="transparent"
          strokeWidth={12 / zoom}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        />
      )}

      {/* Visible line */}
      <line
        x1={fromPt.x}
        y1={fromPt.y}
        x2={toPt.x}
        y2={toPt.y}
        stroke={selected ? '#2563eb' : '#333'}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
      />

      {/* Arrowhead */}
      <polygon
        points={`${arrowTipX},${arrowTipY} ${arrowLeftX},${arrowLeftY} ${arrowRightX},${arrowRightY}`}
        fill={selected ? '#2563eb' : '#333'}
      />

      {/* End handles when selected */}
      {selected && (
        <>
          <circle
            data-testid="connector-handle-from"
            cx={fromPt.x}
            cy={fromPt.y}
            r={CONNECTOR_DOT_RADIUS_PX / zoom}
            fill="white"
            stroke="#2563eb"
            strokeWidth={2 / zoom}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={handleEndPointerDown('from')}
          />
          <circle
            data-testid="connector-handle-to"
            cx={toPt.x}
            cy={toPt.y}
            r={CONNECTOR_DOT_RADIUS_PX / zoom}
            fill="white"
            stroke="#2563eb"
            strokeWidth={2 / zoom}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={handleEndPointerDown('to')}
          />
        </>
      )}

      {/* Drag preview line */}
      {draggingEnd && dragPos && (
        <line
          x1={draggingEnd === 'from' ? dragPos.x : toPt.x}
          y1={draggingEnd === 'from' ? dragPos.y : toPt.y}
          x2={draggingEnd === 'from' ? fromPt.x : toPt.x}
          y2={draggingEnd === 'from' ? fromPt.y : toPt.y}
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      )}
    </svg>
  );
}
