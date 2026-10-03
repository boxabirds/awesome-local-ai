/**
 * Stroke object renderer (story 11, stroke.object).
 *
 * Renders an SVG path with smooth quadratic curves, round caps/joins.
 * The path is scaled to the current object width/height using the stored
 * baseWidth/baseHeight ratios. Thickness is not scaled.
 */

import type { JSX } from 'react';
import type { ObjectProps } from './registry';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export function StrokeObject({ obj, selected }: ObjectProps): JSX.Element {
  const stroke = obj as unknown as StrokeSnap;
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const color = PEN_COLORS[stroke.color as PenColor] ?? PEN_COLORS.black;
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness as PenThickness] ?? 4;

  return (
    <div
      data-testid="stroke-object"
      data-id={obj.id}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={obj.width}
        height={obj.height}
        style={{ overflow: 'visible', display: 'block' }}
        aria-label="Drawing"
        role="img"
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
