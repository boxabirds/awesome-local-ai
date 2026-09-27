// Stroke (freehand pen) object (see spec: stroke.render).
//
// Rendered in world space as an SVG path: the points are re-derived from the
// bbox at the current size (`scaledPoints`) and drawn as midpoint quadratic
// curves (`smoothPath`). The visible path uses the stored thickness in board
// units (it is never scaled by resizes, pen.resize); the wide invisible hit
// path is exactly 2 * max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom) world
// units thick, so a click within STROKE_HIT_TOLERANCE_PX screen pixels of the
// line selects the stroke (pen.select, TC-21).
//
// Selection, move (drag the body), proportional resize (corner handles,
// aspect-locked in the registry) and delete are the generic story 7/8
// object operations — this component only renders and routes pointer-down.

import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  zoom: number;
  selected: boolean;
  editable: boolean;
  onObjectPointerDown(e: React.PointerEvent<HTMLElement>, id: string): void;
  onFocusSelect(id: string): void;
}

/** The stroke object (see spec: stroke.render). */
export function StrokeObject({
  stroke,
  zoom,
  selected,
  editable,
  onObjectPointerDown,
  onFocusSelect,
}: StrokeObjectProps): JSX.Element {
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  // Screen-px tolerance in world units; at least the half-width of the line
  // itself, so a click on the visible ink always selects.
  const hitStroke = 2 * Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);

  return (
    <svg
      data-testid="stroke-object"
      data-id={stroke.id}
      role="img"
      aria-label="Drawing"
      className="stroke-object"
      data-selected={selected || undefined}
      tabIndex={0}
      onFocus={() => {
        if (!selected) onFocusSelect(stroke.id);
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {/* Wide invisible hit path: the click tolerance on screen. */}
      <path
        data-testid="stroke-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitStroke}
        style={{ pointerEvents: 'stroke', cursor: editable ? 'pointer' : 'default' }}
        onPointerDown={(e) =>
          onObjectPointerDown(e as unknown as React.PointerEvent<HTMLElement>, stroke.id)
        }
      />
      <path
        data-testid="stroke-path"
        d={d}
        fill="none"
        stroke={PEN_COLORS[stroke.color]}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
