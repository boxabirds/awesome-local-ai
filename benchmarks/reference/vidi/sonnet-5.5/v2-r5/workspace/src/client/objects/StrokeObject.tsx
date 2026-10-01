import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

const PRIMARY_BUTTON = 0;
const HALF = 2;

/**
 * The element itself takes no pointer events: only a transparent, line-hugging path does, so a click inside the
 * stroke's box but away from the line reaches whatever lies underneath.
 */
export function StrokeObject(props: ObjectProps) {
  const { selected, dragging, zoom } = props;
  const stroke = props.object as StrokeSnap;
  const width = stroke.width ?? stroke.baseWidth;
  const height = stroke.height ?? stroke.baseHeight;
  const d = smoothPath(scaledPoints(stroke));
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  return (
    <svg
      role="img"
      aria-label="Drawing"
      data-stroke=""
      data-id={stroke.id}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-x={stroke.x}
      data-y={stroke.y}
      data-width={width}
      data-height={height}
      data-selected={selected}
      data-dragging={dragging}
      className="stroke-object"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ left: stroke.x, top: stroke.y, zIndex: stroke.z, pointerEvents: 'none' }}
    >
      <path
        d={d}
        fill="none"
        stroke={PEN_COLORS[stroke.color]}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        data-testid="stroke-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(thickness, (HALF * STROKE_HIT_TOLERANCE_PX) / zoom)}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: dragging ? 'grabbing' : 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
          e.stopPropagation();
          props.onPointerDown(e, stroke.id);
        }}
      />
    </svg>
  );
}
