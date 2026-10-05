import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import type { PenColor, PenThickness, StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '2px solid #1A73E8';

/**
 * One pen stroke in the world layer (story 11). Renders the smoothed SVG
 * path (`d = smoothPath(scaledPoints)`) with round caps/joins, the stored
 * thickness in world units (it never scales with the bbox) and the stored
 * pen colour. Remote strokes render identically as soon as the snapshot
 * updates.
 *
 * Selection is by the line (pen.select): the container is pointer-transparent
 * so clicks in empty space inside the bbox fall through to objects below;
 * only the widened invisible hit path (stroke area = max(thickness/2,
 * STROKE_HIT_TOLERANCE_PX / zoom) around the line) starts the selection
 * gesture.
 */
export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, zoom, selected, dragging, onObjectPointerDown } = props;

  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const thicknessName = (obj.thickness ?? 'medium') as PenThickness;
  const colorName = (obj.color ?? 'black') as PenColor;
  const stroke: StrokeSnap = {
    ...obj,
    type: 'stroke',
    points: obj.points ?? [],
    baseWidth: obj.baseWidth ?? width,
    baseHeight: obj.baseHeight ?? height,
    thickness: thicknessName,
    color: colorName,
  };
  const thickness = PEN_THICKNESS_WORLD[thicknessName];
  // The SVG is local to the bbox (its origin is the bbox origin), so the
  // path is drawn from the stored *relative* points scaled by the current
  // resize ratio (width/baseWidth, height/baseHeight). World-space points
  // (scaledPoints) are used for hit testing instead.
  const sx = stroke.baseWidth > 0 ? width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? height / stroke.baseHeight : 1;
  const localPts: Point[] = [];
  const rel = stroke.points;
  for (let i = 0; i + 1 < rel.length; i += 2) {
    localPts.push({ x: rel[i] * sx, y: rel[i + 1] * sy });
  }
  const d = smoothPath(localPts);
  // Hit area: max(half the thickness, STROKE_HIT_TOLERANCE_PX at this zoom)
  // on each side of the line — the same rule as the registry hitTest.
  const hitWidth = Math.max(thickness, (2 * STROKE_HIT_TOLERANCE_PX) / (zoom || 1));

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onObjectPointerDown(e, obj.id);
  };

  return (
    <div
      data-stroke-id={obj.id}
      data-selected={selected}
      data-dragging={dragging || undefined}
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <path
          data-testid="stroke-path"
          d={d}
          fill="none"
          stroke={PEN_COLORS[colorName]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={handlePointerDown}
        />
      </svg>
    </div>
  );
}
