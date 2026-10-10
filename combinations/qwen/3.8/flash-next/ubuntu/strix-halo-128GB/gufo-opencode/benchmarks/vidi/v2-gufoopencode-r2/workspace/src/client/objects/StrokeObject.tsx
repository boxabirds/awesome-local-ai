// One freehand stroke: an SVG path through the stored points scaled to the
// object's current width/height (quadratic-midpoint smoothing, round caps).
// Selection uses a precise distance-to-line hit (half thickness or
// STROKE_HIT_TOLERANCE_PX in screen space, whichever is larger), not the
// bbox, so clicks inside the box but far from the line fall through.

import { useCallback } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

export type StrokeObjectProps = ObjectProps;

export function StrokeObject({
  obj,
  zoom,
  selected,
  onObjectPointerDown,
  clientToWorld,
}: StrokeObjectProps): React.JSX.Element {
  const stroke = obj as StrokeSnap;
  const width = stroke.width ?? stroke.baseWidth;
  const height = stroke.height ?? stroke.baseHeight;

  // Quadratic midpoint smoothing over the scaled points (element-local).
  const local = scaledPoints(stroke).map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
  const d = smoothPath(local);

  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  const hitWidth = 2 * Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / (zoom || 1));

  const nearLine = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (!clientToWorld) return true;
      const p = clientToWorld(e.clientX, e.clientY);
      const tol = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / (zoom || 1));
      return distanceToPolyline(scaledPoints(stroke), p) <= tol;
    },
    [clientToWorld, stroke, thickness, zoom],
  );

  return (
    <div
      role="group"
      aria-label="Drawing"
      data-testid="stroke-object"
      data-stroke-id={stroke.id}
      data-selected={selected ? 'true' : 'false'}
      className="stroke-object"
      style={
        {
          left: stroke.x,
          top: stroke.y,
          width: Math.max(width, 1),
          height: Math.max(height, 1),
          zIndex: stroke.z,
        } as React.CSSProperties
      }
    >
      <svg
        className="stroke-object-svg"
        width={Math.max(width, 1)}
        height={Math.max(height, 1)}
        viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
        data-testid="stroke-svg"
      >
        {/* Invisible wide stroke: precise near-line hit target. */}
        <path
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => {
            if (!nearLine(e)) return; // far clicks pass through to objects below
            e.stopPropagation();
            onObjectPointerDown(e, stroke.id);
          }}
        />
        <path
          data-testid="stroke-line"
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  );
}
