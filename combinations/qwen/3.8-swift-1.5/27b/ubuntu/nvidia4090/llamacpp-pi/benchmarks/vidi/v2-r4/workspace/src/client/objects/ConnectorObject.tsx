import { useRef, useCallback, type JSX } from 'react';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';
import type { ConnectorSnap } from '../../shared/geometry/connector-geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import type { Endpoint } from '../../shared/objects/connector';
import type { ObjectProps } from './registry';
import type { Rect } from '../../shared/geometry';

interface ConnectorObjectProps extends ObjectProps {
  rects: ReadonlyMap<string, Rect>;
  onReattach?: (connectorId: string, end: 'from' | 'to', ep: Endpoint) => void;
}

export function ConnectorObjectComponent(props: ConnectorObjectProps): JSX.Element {
  const { obj, selected, zoom, onPointerDown, rects, onReattach } = props;
  const connector = obj as ConnectorSnap;
  const { from, to } = connector;

  const { from: fromPt, to: toPt } = resolveEndpoints({ from, to }, rects);

  // Handle dragging end handles
  const draggingEndRef = useRef<'from' | 'to' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEndPointerDown = useCallback(
    (e: React.PointerEvent, end: 'from' | 'to') => {
      e.stopPropagation();
      e.preventDefault();
      draggingEndRef.current = end;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const handleUp = (ue: PointerEvent) => {
        draggingEndRef.current = null;
        (ue.currentTarget as HTMLElement).releasePointerCapture(ue.pointerId);

        // Determine where the handle was released
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const screenX = ue.clientX - rect.left;
        const screenY = ue.clientY - rect.top;

        // Convert to world coords
        const worldX = screenX / zoom;
        const worldY = screenY / zoom;

        // Hit test against objects to find target
        let targetId: string | null = null;
        for (const [oid, oRect] of rects) {
          if (oid === connector.id) continue;
          if (
            worldX >= oRect.x &&
            worldX <= oRect.x + oRect.width &&
            worldY >= oRect.y &&
            worldY <= oRect.y + oRect.height
          ) {
            targetId = oid;
            break;
          }
        }

        // Check if target is the opposite end's object
        const otherEnd = end === 'from' ? to : from;
        if (targetId && otherEnd.kind === 'attached' && otherEnd.objectId === targetId) {
          return; // snap back - rejected
        }

        let newEp: Endpoint;
        if (targetId) {
          newEp = {
            kind: 'attached',
            objectId: targetId,
            fallback: { x: worldX, y: worldY },
          };
        } else {
          newEp = { kind: 'free', x: worldX, y: worldY };
        }

        onReattach?.(connector.id, end, newEp);
      };

      (e.currentTarget as HTMLElement).addEventListener('pointerup', handleUp, { once: true });
    },
    [zoom, rects, connector.id, from, to, onReattach],
  );

  const handleSize = 8 / zoom; // Keep handles same screen size

  return (
    <div
      ref={containerRef}
      data-testid="connector-object"
      data-note-id={connector.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
      onPointerDown={(e) => {
        if (selected) return;
        onPointerDown(e, connector.id);
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          <marker
            id={`arrowhead-${connector.id}`}
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`0,0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD},${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} 0,${CONNECTOR_ARROWHEAD_SIZE_WORLD}`}
              fill="#263238"
            />
          </marker>
        </defs>
        <line
          x1={fromPt.x}
          y1={fromPt.y}
          x2={toPt.x}
          y2={toPt.y}
          stroke={selected ? '#2196F3' : '#263238'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#arrowhead-${connector.id})`}
        />
        {selected && (
          <>
            <circle
              cx={fromPt.x}
              cy={fromPt.y}
              r={handleSize}
              fill="#2196F3"
              stroke="#fff"
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'move' }}
              data-testid="connector-handle-from"
              onPointerDown={(e) => handleEndPointerDown(e, 'from')}
            />
            <circle
              cx={toPt.x}
              cy={toPt.y}
              r={handleSize}
              fill="#2196F3"
              stroke="#fff"
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'move' }}
              data-testid="connector-handle-to"
              onPointerDown={(e) => handleEndPointerDown(e, 'to')}
            />
          </>
        )}
      </svg>
    </div>
  );
}
