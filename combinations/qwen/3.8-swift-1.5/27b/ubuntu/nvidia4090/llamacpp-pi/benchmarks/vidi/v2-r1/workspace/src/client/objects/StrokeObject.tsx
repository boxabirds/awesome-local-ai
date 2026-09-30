/**
 * Story 11: StrokeObject — renders a finished stroke as a smoothed SVG
 * path with round ends and joins.
 *
 * - The visible path scales with the object's current width/height
 *   (scaledPoints) while the stroke-width stays the stored thickness, so
 *   proportional resize keeps the line thickness unchanged (PRD
 *   pen.resize).
 * - An invisible widened hit path (pointer-events: stroke) makes the
 *   stroke selectable by its line: clicks within
 *   max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom) of the line select
 *   the stroke; clicks inside the bbox but farther away fall through to
 *   objects underneath (PRD pen.select).
 * - Remote strokes render identically as soon as the snapshot updates.
 */
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '@shared/config';
import { smoothPath } from '@shared/geometry/simplify';
import type { StrokeSnap } from '@shared/objects/stroke';
import type { ObjectProps } from './registry';
import type { Point } from '@shared/geometry';

export function StrokeObject(props: ObjectProps) {
  const { obj, zoom, selected, onObjectPointerDown } = props;
  const stroke = obj as StrokeSnap;

  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const color = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;

  // Stored points scaled to the CURRENT size, relative to the bbox origin.
  const sx = stroke.baseWidth > 0 ? obj.width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? obj.height / stroke.baseHeight : 1;
  const rel: Point[] = [];
  const pts = stroke.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    rel.push({ x: pts[i] * sx, y: pts[i + 1] * sy });
  }
  const d = smoothPath(rel);

  // Hit area: at least the visible line, widened to the hit tolerance in
  // WORLD units (STROKE_HIT_TOLERANCE_PX screen pixels at this zoom).
  const hitWidth = Math.max(thickness, (STROKE_HIT_TOLERANCE_PX * 2) / zoom);

  return (
    <svg
      data-testid="stroke-object"
      data-stroke-id={obj.id}
      data-selected={selected ? '' : undefined}
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: obj.z,
      }}
    >
      {/* Visible stroke. */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
      {/* Invisible widened hit path: selects the stroke by its line only. */}
      <path
        data-testid="stroke-hit-path"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: 'move' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onObjectPointerDown(e, obj.id);
        }}
      />
    </svg>
  );
}
