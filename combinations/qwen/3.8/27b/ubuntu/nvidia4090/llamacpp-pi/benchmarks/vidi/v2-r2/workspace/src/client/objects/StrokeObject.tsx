/**
 * One pen stroke (story 11, stroke.ui): a freehand path rendered as an SVG
 * path with round caps and joins, at the stored thickness and colour.
 *
 * Selection, move, proportional resize, nudge, delete, marquee and undo
 * come unchanged from stories 7 and 8 via the registry: the object only
 * reports, exactly like the sticky note.
 *
 * The object's div is pointer-transparent — only the invisible wide hit
 * path along the line accepts presses (pen.select: a click within
 * max(thickness/2, STROKE_HIT_TOLERANCE_PX) of the line hits; a click
 * inside the bbox but far from the line falls through to the object
 * underneath). The hit width keeps the same screen tolerance at every
 * zoom (it is divided by the zoom to stay in world units).
 *
 * Remote strokes render identically as soon as the snapshot updates:
 * the same scaledPoints + smoothPath the drawer used.
 */
import { type JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { scaledRelativePoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { ObjectProps } from './registry';

export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, selected, inert, camera, onPointerDown } = props;
  const stroke = obj as StrokeSnap;
  const width = typeof obj.width === 'number' ? obj.width : 0;
  const height = typeof obj.height === 'number' ? obj.height : 0;
  const zoom = camera?.zoom ?? 1;
  const safeZoom = zoom > 0 ? zoom : 1;

  const thicknessName: PenThickness =
    typeof stroke.thickness === 'string' && stroke.thickness in PEN_THICKNESS_WORLD
      ? (stroke.thickness as PenThickness)
      : 'medium';
  const colorName: PenColor =
    typeof stroke.color === 'string' && stroke.color in PEN_COLORS
      ? (stroke.color as PenColor)
      : 'black';
  const thickness = PEN_THICKNESS_WORLD[thicknessName];
  const color = PEN_COLORS[colorName];
  // Path coordinates are RELATIVE to the bbox origin: the object div sits
  // at the bbox origin and the SVG uses a local viewBox (0..width, 0..height).
  const d = smoothPath(scaledRelativePoints(stroke));

  // Hit tolerance in world units: the larger of half the thickness and the
  // screen-pixel tolerance converted to world units (constant at every zoom).
  const hitWidth = Math.max(thickness, (2 * STROKE_HIT_TOLERANCE_PX) / safeZoom);
  const svgWidth = Math.max(width, 1);
  const svgHeight = Math.max(height, 1);

  return (
    <div
      data-stroke-object={obj.id}
      data-object-id={obj.id}
      data-testid="stroke-object"
      data-color={colorName}
      data-thickness={thicknessName}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: obj.z,
        overflow: 'visible',
        outline: selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 2,
        // The div never intercepts: only the hit path along the line does.
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {!inert && (
          <path
            data-testid="stroke-hit-path"
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={hitWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, obj.id);
            }}
          />
        )}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
          role="img"
          aria-label="Drawing"
        />
      </svg>
    </div>
  );
}
