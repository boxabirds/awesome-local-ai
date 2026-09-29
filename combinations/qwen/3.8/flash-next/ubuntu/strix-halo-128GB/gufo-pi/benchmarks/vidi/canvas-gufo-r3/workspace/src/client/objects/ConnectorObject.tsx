import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { ConnectorSnap } from '@shared/board-model';
import type { Endpoint } from '@shared/objects/connector';
import { setConnectorEndpoint } from '@shared/objects/connector';
import { resolveEndpoints } from '@shared/geometry/connector-geometry';
import type { Rect } from '@shared/geometry';
import type { Camera, Point } from '@client/canvas/camera';
import { screenToWorld } from '@client/canvas/camera';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from '@shared/config';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  doc: Y.Doc;
  zoom: number;
  camera: Camera;
  /** Live rects of every attachable object, for endpoint resolution and drop hit-testing. */
  rects: ReadonlyMap<string, Rect>;
  selected: boolean;
  readOnly: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  undoController?: { boundary(): void } | null;
}

const HIT_ZOOM_REF = 1; // tolerance is expressed in screen px; divide by zoom for world units

function hitObjectAt(rects: ReadonlyMap<string, Rect>, p: Point, excludeId: string | null): string | null {
  let best: string | null = null;
  let bestZ = -Infinity;
  for (const [id, r] of rects) {
    if (id === excludeId) continue;
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
      // later entries are fine; ties resolved arbitrarily
      best = id;
      bestZ = 0;
      void bestZ;
    }
  }
  return best;
}

/**
 * Renders one connector as a line with an arrowhead at the target end.
 * Endpoints are resolved from the live object rects on every render, so the arrow
 * follows moved shapes without any writes. Clicking within CONNECTOR_HIT_TOLERANCE_PX
 * of the line selects it. When selected, both ends show draggable handles that
 * re-attach, detach, or snap back.
 */
export function ConnectorObject(props: ConnectorObjectProps): React.ReactElement {
  const { connector, doc, zoom, camera, rects, selected, readOnly, onSelect, onToggle, undoController } = props;
  const [dragEnd, setDragEnd] = useState<Endpoint | null>(null);
  const dragRef = useRef<{ end: 'from' | 'to'; moved: boolean } | null>(null);

  const ends = useMemo(() => resolveEndpoints(connector, rects), [connector, rects]);
  const from: Point =
    dragEnd && dragRef.current?.end === 'from' && dragEnd.kind === 'free'
      ? { x: dragEnd.x, y: dragEnd.y }
      : ends.from;
  const to: Point =
    dragEnd && dragRef.current?.end === 'to' && dragEnd.kind === 'free'
      ? { x: dragEnd.x, y: dragEnd.y }
      : ends.to;

  // Local coordinates inside the SVG's own box (the wrapper sits at the bbox origin)
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  // The SVG needs padding so the horizontal/vertical line and its hit area still render
  const pad = Math.max(8, (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom);
  const svgW = w + pad * 2;
  const svgH = h + pad * 2;
  const fx = from.x - minX + pad;
  const fy = from.y - minY + pad;
  const tx = to.x - minX + pad;
  const ty = to.y - minY + pad;

  const wrapperX = minX - pad;
  const wrapperY = minY - pad;

  const markerId = `arrowhead-${connector.id}`;

  const handleLinePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      if (e.shiftKey && onToggle) onToggle(connector.id);
      else onSelect(connector.id);
    },
    [connector.id, onSelect, onToggle, readOnly],
  );

  const startEndDrag = useCallback(
    (end: 'from' | 'to') => (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect(connector.id);
      dragRef.current = { end, moved: false };
      const anchor = end === 'from' ? ends.from : ends.to;
      setDragEnd({ kind: 'free', x: anchor.x, y: anchor.y });

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        dragRef.current.moved = true;
        const p = screenToWorld(camera, { x: ev.clientX, y: ev.clientY });
        setDragEnd({ kind: 'free', x: p.x, y: p.y });
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const ref = dragRef.current;
        dragRef.current = null;
        setDragEnd(null);
        if (!ref) return;
        const p = screenToWorld(camera, { x: ev.clientX, y: ev.clientY });
        if (!ref.moved) return;
        // Determine target: over another object -> attach; over empty -> free; over the opposite object -> snap back (no-op)
        const opposite = ref.end === 'from' ? connector.to : connector.from;
        const exclude = opposite.kind === 'attached' ? opposite.objectId : null;
        const targetId = hitObjectAt(rects, p, exclude);
        undoController?.boundary();
        if (targetId) {
          setConnectorEndpoint(doc, connector.id, ref.end, {
            kind: 'attached',
            objectId: targetId,
            fallback: { x: p.x, y: p.y },
          });
        } else {
          setConnectorEndpoint(doc, connector.id, ref.end, { kind: 'free', x: p.x, y: p.y });
        }
        undoController?.boundary();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [camera, connector.id, connector.from, connector.to, doc, ends.from, ends.to, onSelect, readOnly, rects, undoController],
  );

  const handleR = CONNECTOR_DOT_RADIUS_PX / zoom;

  return (
    <div
      data-testid="connector-wrapper"
      data-connector-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: wrapperX,
        top: wrapperY,
        width: svgW,
        height: svgH,
        zIndex: connector.z,
        pointerEvents: 'none',
      }}
    >
      <svg width={svgW} height={svgH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD / CONNECTOR_STROKE_WIDTH_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD / CONNECTOR_STROKE_WIDTH_WORLD}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1A1A1A" />
          </marker>
        </defs>
        {/* Wide transparent hit line for tolerant selection */}
        <line
          data-testid="connector-hit"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke="transparent"
          strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom || HIT_ZOOM_REF)}
          style={{ pointerEvents: 'stroke', cursor: readOnly ? 'default' : 'pointer' }}
          onPointerDown={handleLinePointerDown}
        />
        <line
          data-testid="connector-line"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke="#1A1A1A"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${markerId})`}
          style={{ pointerEvents: 'none' }}
        />
        {selected &&
          !readOnly &&
          [
            { end: 'from' as const, cx: fx, cy: fy, key: 'from-handle' },
            { end: 'to' as const, cx: tx, cy: ty, key: 'to-handle' },
          ].map(({ end, cx, cy, key }) => (
            <circle
              key={key}
              data-testid={key}
              data-end={end}
              cx={cx}
              cy={cy}
              r={handleR}
              fill="#FFFFFF"
              stroke="#1976D2"
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startEndDrag(end)}
            />
          ))}
      </svg>
    </div>
  );
}
