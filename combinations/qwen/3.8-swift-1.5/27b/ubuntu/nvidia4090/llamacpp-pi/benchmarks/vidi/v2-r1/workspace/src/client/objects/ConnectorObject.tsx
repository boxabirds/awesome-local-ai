/**
 * Story 10: ConnectorObject — SVG line with arrowhead and end handles.
 */
import { useCallback } from 'react';
import {
  CONNECTOR_STROKE_WIDTH_WORLD, CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from '@shared/config';
import {
  resolveEndpoints, setConnectorEndpoint, type Endpoint,
} from '@shared/objects/connector';
import type { ObjectProps } from './registry';
import type { Rect } from '@shared/geometry';

export function ConnectorObject(props: ObjectProps & { rects?: ReadonlyMap<string, Rect> }) {
  const { obj, doc, zoom, selected, rects } = props;
  const connector = obj as any;
  const from: Endpoint = connector.from;
  const to: Endpoint = connector.to;

  // Resolve endpoints to concrete points
  const resolved = resolveEndpoints({ from, to }, rects ?? new Map());
  const { from: fp, to: tp } = resolved;

  // Arrowhead calculation
  const angle = Math.atan2(tp.y - fp.y, tp.x - fp.x);
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const arrowAngle = Math.PI / 6; // 30 degrees

  const arrow1X = tp.x - arrowSize * Math.cos(angle - arrowAngle);
  const arrow1Y = tp.y - arrowSize * Math.sin(angle - arrowAngle);
  const arrow2X = tp.x - arrowSize * Math.cos(angle + arrowAngle);
  const arrow2Y = tp.y - arrowSize * Math.sin(angle + arrowAngle);

  const handleEndDragStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch { /* jsdom */ }
  }, []);

  const handleEndDragEnd = useCallback((e: React.PointerEvent, end: 'from' | 'to') => {
    e.stopPropagation();
    const svg = (e.target as Element).closest('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    let targetId: string | null = null;
    if (rects) {
      for (const [id, r] of rects) {
        if (id === obj.id) continue;
        const worldX = (screenX / zoom);
        const worldY = (screenY / zoom);
        if (worldX >= r.x && worldX <= r.x + r.width && worldY >= r.y && worldY <= r.y + r.height) {
          targetId = id;
          break;
        }
      }
    }

    const otherEnd = end === 'from' ? to : from;

    if (targetId) {
      if (otherEnd.kind === 'attached' && otherEnd.objectId === targetId) return;
      const newEp: Endpoint = {
        kind: 'attached',
        objectId: targetId,
        fallback: { x: screenX / zoom, y: screenY / zoom },
      };
      setConnectorEndpoint(doc, obj.id, end, newEp);
    } else {
      const newEp: Endpoint = { kind: 'free', x: screenX / zoom, y: screenY / zoom };
      setConnectorEndpoint(doc, obj.id, end, newEp);
    }
  }, [doc, obj.id, from, to, zoom, rects]);

  return (
    <g
      data-testid="connector-object"
      data-connector-id={obj.id}
    >
      <line
        x1={fp.x} y1={fp.y}
        x2={tp.x} y2={tp.y}
        stroke="#263238"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
      />
      <polygon
        points={`${tp.x},${tp.y} ${arrow1X},${arrow1Y} ${arrow2X},${arrow2Y}`}
        fill="#263238"
      />
      {selected && (
        <>
          <circle
            data-testid="connector-handle-from"
            cx={fp.x} cy={fp.y}
            r={CONNECTOR_DOT_RADIUS_PX / zoom}
            fill="#2196F3"
            stroke="#fff"
            strokeWidth={1 / zoom}
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => handleEndDragStart(e)}
            onPointerUp={(e) => handleEndDragEnd(e, 'from')}
          />
          <circle
            data-testid="connector-handle-to"
            cx={tp.x} cy={tp.y}
            r={CONNECTOR_DOT_RADIUS_PX / zoom}
            fill="#2196F3"
            stroke="#fff"
            strokeWidth={1 / zoom}
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => handleEndDragStart(e)}
            onPointerUp={(e) => handleEndDragEnd(e, 'to')}
          />
        </>
      )}
    </g>
  );
}
