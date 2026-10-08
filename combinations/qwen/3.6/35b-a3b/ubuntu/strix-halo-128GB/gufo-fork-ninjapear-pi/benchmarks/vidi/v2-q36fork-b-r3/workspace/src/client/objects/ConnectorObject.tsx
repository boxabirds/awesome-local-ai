import React, { memo } from 'react';
import type { Camera } from '../canvas/camera';
import type { ObjectSnap, ConnectorSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import { getResolvedEndpoints } from '@shared/objects/connector';
import { CONNECTOR_DOT_RADIUS_PX } from '@shared/config';

interface ConnectorObjectProps {
  snap: ConnectorSnapshot;
  boardSnapshot: readonly ObjectSnap[];
  camera: Camera;
  selected?: boolean;
}

export const ConnectorObject = memo(function ConnectorObject({ snap, boardSnapshot, camera, selected }: ConnectorObjectProps) {
  if (snap.type !== 'connector') return null;

  // Build rects map for endpoint resolution
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const obj of boardSnapshot) {
    if (obj.type === 'shape' || obj.type === 'sticky') {
      const bounds = objectBounds(obj as any);
      rects.set(obj.id, bounds);
    }
    // text and connector objects don't have useful rect data
  }

  try {
    const resolved = getResolvedEndpoints(snap, rects);
    const strokeWidth = (selected ? 2.5 : 1.8) / camera.zoom;

    // Resize handle dots at each end
    const dotR = CONNECTOR_DOT_RADIUS_PX / camera.zoom;

    return (
      <>
        {/* Connector line */}
        <line
          x1={resolved.from.x}
          y1={resolved.from.y}
          x2={resolved.to.x}
          y2={resolved.to.y}
          stroke={selected ? '#2196F3' : '#757575'}
          strokeWidth={strokeWidth}
          markerEnd={`url(#arrowhead-${selected ? 'sel' : 'default'})`}
        />
        {/* Re-attach handle at 'from' end */}
        <circle
          cx={resolved.from.x}
          cy={resolved.from.y}
          r={dotR}
          fill={selected ? '#2196F3' : '#9E9E9E'}
          stroke="white"
          strokeWidth={1 / camera.zoom}
          style={{ cursor: 'crosshair' }}
        />
        {/* Re-attach handle at 'to' end */}
        <circle
          cx={resolved.to.x}
          cy={resolved.to.y}
          r={dotR}
          fill={selected ? '#2196F3' : '#9E9E9E'}
          stroke="white"
          strokeWidth={1 / camera.zoom}
          style={{ cursor: 'crosshair' }}
        />
      </>
    );
  } catch {
    return null;
  }
});
