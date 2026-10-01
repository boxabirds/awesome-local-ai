import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { ObjectProps } from './registry';

/**
 * Stroke object rendering (stroke.object).
 *
 * - The visible path is `smoothPath` of the stroke's scaled points with round
 *   caps and joins; the stroke-width is the stored thickness in world units
 *   (it never scales with the bbox).
 * - The wrapper is pointer-transparent: only the line is interactive, so
 *   clicks in empty space inside the stroke's bounds fall through to the
 *   objects underneath (pen.select).
 * - An invisible, wider hit path makes the line selectable up to
 *   max(thickness/2, STROKE_HIT_TOLERANCE_PX) screen distance.
 */
export function StrokeObjectComponent(props: ObjectProps): JSX.Element {
  const { obj, zoom, selected, editable, onPointerDown } = props;
  const stroke = obj as StrokeSnap;
  const { x, y, width, height, color, thickness } = stroke;

  const strokeWidth = PEN_THICKNESS_WORLD[thickness] ?? PEN_THICKNESS_WORLD.medium;
  const colorValue = PEN_COLORS[color] ?? PEN_COLORS.black;

  // Local (bbox-relative) points for the SVG path
  const localPts = scaledPoints(stroke).map((p) => ({ x: p.x - x, y: p.y - y }));
  const d = smoothPath(localPts);

  // Hit area: half thickness or 6 screen px, whichever is larger
  const hitWidth = Math.max(strokeWidth, (2 * STROKE_HIT_TOLERANCE_PX) / zoom);

  return (
    <div
      data-testid="stroke-object"
      data-selected={selected || undefined}
      data-note-id={stroke.id}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <path
          d={d}
          fill="none"
          stroke={colorValue}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="Drawing"
          style={{ pointerEvents: 'none' }}
        />
        {editable && (
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={hitWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'grab' }}
            onPointerDown={(e) => onPointerDown(e, stroke.id)}
          />
        )}
      </svg>
    </div>
  );
}
