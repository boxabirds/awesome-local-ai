import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ConnectorObjectSnapshot, ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import {
  resolveEndpoints,
  sideAnchor,
  nearestSide,
} from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { CONNECTOR_STROKE_WIDTH_WORLD, CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Rect, Point } from '../../shared/geometry';

export interface ConnectorObjectProps {
  connector: ConnectorObjectSnapshot;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  camera: { x: number; y: number; zoom: number };
  snapshot: readonly ObjectSnapshot[];
  onSelect(id: string): void;
  onBoundary?(): void;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const { connector, rects, doc, selected, camera, snapshot, onSelect, onBoundary } = props;

  const resolved = resolveEndpoints(connector.from, connector.to, rects);
  const { from, to } = resolved;

  // Convert to screen coordinates for SVG rendering
  const sx1 = (from.x - camera.x) * camera.zoom;
  const sy1 = (from.y - camera.y) * camera.zoom;
  const sx2 = (to.x - camera.x) * camera.zoom;
  const sy2 = (to.y - camera.y) * camera.zoom;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(connector.id);
  }, [connector.id, onSelect]);

  // Hit test area: invisible wider line for click detection
  const hitWidth = CONNECTOR_HIT_TOLERANCE_PX * 2;

  // Arrowhead calculation
  const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD * camera.zoom;
  const ax1 = sx2 - arrowSize * Math.cos(angle - Math.PI / 6);
  const ay1 = sy2 - arrowSize * Math.sin(angle - Math.PI / 6);
  const ax2 = sx2 - arrowSize * Math.cos(angle + Math.PI / 6);
  const ay2 = sy2 - arrowSize * Math.sin(angle + Math.PI / 6);

  // End handles for re-attach
  const handleSize = 8;
  const [dragEnd, setDragEnd] = useState<'from' | 'to' | null>(null);
  const dragEndRef = useRef<'from' | 'to' | null>(null);
  const [handlePos, setHandlePos] = useState<Point | null>(null);

  const onHandleDown = useCallback((end: 'from' | 'to') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragEndRef.current = end;
    setDragEnd(end);
    const pos = end === 'from' ? { x: sx1, y: sy1 } : { x: sx2, y: sy2 };
    setHandlePos(pos);
    onBoundary?.();

    const onMove = (me: PointerEvent) => {
      setHandlePos({ x: me.clientX, y: me.clientY });
    };

    const onUp = (ue: PointerEvent) => {
      cleanup();
      const currentEnd = dragEndRef.current;
      dragEndRef.current = null;
      setDragEnd(null);
      setHandlePos(null);
      if (!currentEnd) return;

      const endWorld: Point = {
        x: ue.clientX / camera.zoom + camera.x,
        y: ue.clientY / camera.zoom + camera.y,
      };

      // Hit test to find target object
      const objects = snapshot.filter((o) => o.type !== 'connector');
      let targetId: string | null = null;
      let targetRect: Rect | null = null;
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        // Don't attach to the object at the opposite end
        const opposite = currentEnd === 'from' ? connector.to : connector.from;
        if (opposite.kind === 'attached' && obj.id === opposite.objectId) continue;
        const bounds = objectBounds(obj);
        if (
          endWorld.x >= bounds.x && endWorld.x <= bounds.x + bounds.width &&
          endWorld.y >= bounds.y && endWorld.y <= bounds.y + bounds.height
        ) {
          targetId = obj.id;
          targetRect = bounds;
          break;
        }
      }

      const otherEp = currentEnd === 'from' ? connector.to : connector.from;
      const otherPt = otherEp.kind === 'free'
        ? { x: otherEp.x, y: otherEp.y }
        : (() => { const or = rects.get(otherEp.objectId); return or ? { x: or.x + or.width / 2, y: or.y + or.height / 2 } : (otherEp as any).fallback; })();

      if (targetId && targetRect) {
        const side = nearestSide(targetRect, otherPt);
        const anchor = sideAnchor(targetRect, side);
        setConnectorEndpoint(doc, connector.id, currentEnd, { kind: 'attached', objectId: targetId, fallback: anchor });
      } else {
        setConnectorEndpoint(doc, connector.id, currentEnd, { kind: 'free', x: endWorld.x, y: endWorld.y });
      }
    };

    const onCancel = () => {
      cleanup();
      dragEndRef.current = null;
      setDragEnd(null);
      setHandlePos(null);
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }, [connector, doc, camera, snapshot, rects, onBoundary]);

  const finalFrom = dragEnd === 'from' && handlePos ? handlePos : { x: sx1, y: sy1 };
  const finalTo = dragEnd === 'to' && handlePos ? handlePos : { x: sx2, y: sy2 };

  return (
    <>
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}
        data-testid={`connector-${connector.id}`}
      >
        {/* Invisible hit area */}
        <line
          x1={finalFrom.x}
          y1={finalFrom.y}
          x2={finalTo.x}
          y2={finalTo.y}
          stroke="transparent"
          strokeWidth={hitWidth}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={handlePointerDown}
        />
        {/* Visible line */}
        <line
          x1={finalFrom.x}
          y1={finalFrom.y}
          x2={finalTo.x}
          y2={finalTo.y}
          stroke="#263238"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * camera.zoom}
          data-testid={`connector-line-${connector.id}`}
        />
        {/* Arrowhead */}
        <polygon
          points={`${finalTo.x},${finalTo.y} ${ax1},${ay1} ${ax2},${ay2}`}
          fill="#263238"
        />
        {/* Selection handles */}
        {selected && (
          <>
            <circle
              cx={finalFrom.x}
              cy={finalFrom.y}
              r={handleSize / 2}
              fill="#fff"
              stroke="#1E88E5"
              strokeWidth={2}
              style={{ pointerEvents: 'all', cursor: 'crosshair' }}
              onPointerDown={onHandleDown('from')}
              data-testid="connector-handle-from"
            />
            <circle
              cx={finalTo.x}
              cy={finalTo.y}
              r={handleSize / 2}
              fill="#fff"
              stroke="#1E88E5"
              strokeWidth={2}
              style={{ pointerEvents: 'all', cursor: 'crosshair' }}
              onPointerDown={onHandleDown('to')}
              data-testid="connector-handle-to"
            />
          </>
        )}
      </svg>
    </>
  );
}
