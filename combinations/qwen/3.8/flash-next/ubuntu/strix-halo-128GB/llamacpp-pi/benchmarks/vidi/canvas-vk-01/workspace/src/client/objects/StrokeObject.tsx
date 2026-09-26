import { type JSX } from 'react';

import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/**
 * Renders a freehand stroke as an SVG path. The path is derived from the stored
 * points scaled to the current width/height (proportional resize scales geometry
 * without rewriting points, and thickness stays constant).
 *
 * Uses round line caps and joins for smooth ends.
 */
export function StrokeObject({ obj, selected, zoom, onObjectPointerDown }: ObjectProps): JSX.Element {
  const stroke = obj as unknown as StrokeSnap;
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const width = stroke.width ?? 0;
  const height = stroke.height ?? 0;
  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness];
  const color = PEN_COLORS[stroke.color];
  // Hit target: transparent thick path for click-to-select (like ConnectorObject)
  const hitWidth = Math.max(thicknessWorld, STROKE_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1));

  return (
    <div
      data-testid={`stroke-object-${stroke.id}`}
      aria-label="Drawing"
      role="img"
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width,
        height,
        overflow: 'visible',
        outline: selected ? '2px solid #2563EB' : 'none',
        outlineOffset: 2,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ overflow: 'visible', display: 'block' }}
      >
        {/* Visible stroke */}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thicknessWorld}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Transparent hit target (wider than visible line) */}
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={(event) => onObjectPointerDown(event, stroke.id)}
        />
      </svg>
    </div>
  );
}
