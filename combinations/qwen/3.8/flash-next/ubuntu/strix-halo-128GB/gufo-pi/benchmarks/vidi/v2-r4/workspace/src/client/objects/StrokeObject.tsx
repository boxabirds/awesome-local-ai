/**
 * StrokeObject: renders a stroke as an SVG path with round caps/joins.
 * Supports pointer events for selection (TC-16: clicking inside bbox but far from
 * line does not select the stroke).
 */
import { useCallback } from 'react';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom?: number;
  onPointerDown?(e: React.PointerEvent<SVGElement>, id: string): void;
}

export function StrokeObject({ stroke, selected, zoom = 1, onPointerDown }: StrokeObjectProps): React.JSX.Element {
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const color = PEN_COLORS[stroke.color];
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  const hitWidth = Math.max(thickness, STROKE_HIT_TOLERANCE_PX * 2 / zoom);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      onPointerDown?.(e, stroke.id);
    },
    [onPointerDown, stroke.id],
  );

  return (
    <g
      data-testid={`stroke-${stroke.id}`}
      aria-label="Drawing"
      data-selected={selected ? 'true' : undefined}
      style={{ pointerEvents: 'auto' }}
      onPointerDown={handlePointerDown}
    >
      {/* Invisible wider stroke for easier hit testing */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke' }}
      />
      {/* Visible stroke */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
}
