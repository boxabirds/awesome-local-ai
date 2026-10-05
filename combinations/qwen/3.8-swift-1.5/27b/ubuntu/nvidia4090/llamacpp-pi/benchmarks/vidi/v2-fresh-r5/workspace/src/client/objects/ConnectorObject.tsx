/**
 * Connector object renderer (story 10). SVG line with arrowhead and
 * end handles for re-attach when selected.
 */
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect, Point } from '../../shared/geometry';
import {
  resolveEndpoints,
  type Endpoint,
  type ConnectorSnap,
} from '../../shared/geometry/connector-geometry';
import {
  setConnectorEndpoint,
} from '../../shared/objects/connector';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

interface ConnectorObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  camera: Camera;
  onEndEdit?: () => void;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { obj, selected, rects, doc, camera } = props;

  const from = obj.from as Endpoint | undefined;
  const to = obj.to as Endpoint | undefined;

  if (!from || !to) return <g data-testid={`connector-${obj.id}`} />;

  const connSnap: ConnectorSnap = {
    id: obj.id,
    type: 'connector',
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
    z: obj.z,
    createdAt: obj.createdAt,
    from,
    to,
  };

  const { from: fromPt, to: toPt } = resolveEndpoints(connSnap, rects);

  // Arrowhead calculation
  const headLen = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const headAngle = Math.PI / 6; // 30 degrees

  // End handle drag state
  const [dragEnd, setDragEnd] = useState<'from' | 'to' | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  const handleEndPointerDown = useCallback((e: React.PointerEvent, end: 'from' | 'to') => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragEnd(end);
    setDragPos(screenToWorld(camera, { x: e.clientX, y: e.clientY }));
  }, [camera]);

  const handleEndPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragEnd) return;
    e.preventDefault();
    setDragPos(screenToWorld(camera, { x: e.clientX, y: e.clientY }));
  }, [camera, dragEnd]);

  const handleEndPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragEnd) return;
    e.preventDefault();
    e.stopPropagation();

    const releaseWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    // Hit test: find if we're over an object
    let targetId: string | null = null;
    rects.forEach((rect, id) => {
      if (id === obj.id) return;
      if (
        releaseWorld.x >= rect.x &&
        releaseWorld.x <= rect.x + rect.width &&
        releaseWorld.y >= rect.y &&
        releaseWorld.y <= rect.y + rect.height
      ) {
        targetId = id;
      }
    });

    if (targetId) {
      setConnectorEndpoint(doc, obj.id, dragEnd, {
        kind: 'attached',
        objectId: targetId,
        fallback: releaseWorld,
      });
    } else {
      setConnectorEndpoint(doc, obj.id, dragEnd, {
        kind: 'free',
        x: releaseWorld.x,
        y: releaseWorld.y,
      });
    }

    setDragEnd(null);
    setDragPos(null);
  }, [camera, dragEnd, doc, obj.id, rects]);

  // Determine the display positions (use drag position if dragging)
  const displayFrom = dragEnd === 'from' && dragPos ? dragPos : fromPt;
  const displayTo = dragEnd === 'to' && dragPos ? dragPos : toPt;

  // Recalculate arrowhead for display
  const dAngle = Math.atan2(displayTo.y - displayFrom.y, displayTo.x - displayFrom.x);
  const dHeadLeft = {
    x: displayTo.x - headLen * Math.cos(dAngle - headAngle),
    y: displayTo.y - headLen * Math.sin(dAngle - headAngle),
  };
  const dHeadRight = {
    x: displayTo.x - headLen * Math.cos(dAngle + headAngle),
    y: displayTo.y - headLen * Math.sin(dAngle + headAngle),
  };

  return (
    <g data-testid={`connector-${obj.id}`}>
      {/* Line */}
      <line
        x1={displayFrom.x}
        y1={displayFrom.y}
        x2={displayTo.x}
        y2={displayTo.y}
        stroke={selected ? '#1a73e8' : '#263238'}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
      />
      {/* Arrowhead */}
      <polygon
        points={`${displayTo.x},${displayTo.y} ${dHeadLeft.x},${dHeadLeft.y} ${dHeadRight.x},${dHeadRight.y}`}
        fill={selected ? '#1a73e8' : '#263238'}
      />
      {/* End handles (only when selected) */}
      {selected && (
        <>
          <circle
            data-testid={`connector-from-handle-${obj.id}`}
            cx={fromPt.x}
            cy={fromPt.y}
            r={5}
            fill="white"
            stroke="#1a73e8"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => handleEndPointerDown(e, 'from')}
            onPointerMove={handleEndPointerMove}
            onPointerUp={handleEndPointerUp}
          />
          <circle
            data-testid={`connector-to-handle-${obj.id}`}
            cx={toPt.x}
            cy={toPt.y}
            r={5}
            fill="white"
            stroke="#1a73e8"
            strokeWidth={2}
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
