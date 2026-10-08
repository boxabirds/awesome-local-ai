// Connector tool placeholder — actual interaction handled via BoardViewport + ConnectorObject handles.
// This component provides hover dots on objects when the Connector tool is active,
// letting users re-attach existing connectors by clicking endpoints.

import React, { useState, useCallback, useRef } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnap } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import type { Rect } from '@shared/geometry';
import { nearestSide, sideAnchor } from '@shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '@shared/config';

interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnap[];
}

/** Hit-test if a world point is inside an object's bounds. */
function hitTestObject(obj: any, pt: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    pt.x >= bounds.x &&
    pt.x <= bounds.x + bounds.width &&
    pt.y >= bounds.y &&
    pt.y <= bounds.y + bounds.height
  );
}

export function ConnectorTool({ camera, snapshot }: ConnectorToolProps) {
  const [hoveredObjId, setHoveredObjId] = useState<string | null>(null);
  const mouseRef = useRef<Point>({ x: 0, y: 0 });

  // This component receives pointer events from BoardViewport overlay
  const handlePointerMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    mouseRef.current = wp;
    const hits = snapshot.filter(
      (obj) => obj.type !== 'connector' && hitTestObject(obj as any, wp),
    );
    setHoveredObjId(hits.length > 0 ? hits[0].id : null);
  }, [camera, snapshot]);

  const handlePointerLeave = useCallback(() => {
    setHoveredObjId(null);
  }, []);

  // Compute hover dots for the hovered object
  const hoverDots = (() => {
    if (!hoveredObjId) return [];
    const obj = snapshot.find((o) => o.id === hoveredObjId);
    if (!obj || obj.type !== 'sticky') return [];
    const bounds = objectBounds(obj as any);
    return ['top', 'right', 'bottom', 'left'].map((s) => ({
      pos: sideAnchor(bounds, s as any),
      highlighted: false,
    }));
  })();

  if (hoverDots.length === 0) return null;

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {hoverDots.map((dot, i) => (
        <circle
          key={i}
          cx={dot.pos.x}
          cy={dot.pos.y}
          r={CONNECTOR_DOT_RADIUS_PX / camera.zoom}
          fill="#757575"
          stroke="white"
          strokeWidth={1 / camera.zoom}
          style={{ cursor: 'crosshair' }}
        />
      ))}
    </div>
  );
}
