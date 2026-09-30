/**
 * Stroke object renderer (story 11, stroke.object).
 *
 * Renders the stored (scaled) points as a smoothed SVG path with round ends
 * and joins. `stroke-width` is the stored thickness in world units and is
 * never scaled, so proportional resize keeps the line weight.
 *
 * Selection is by the line (pen.select): the SVG root has no pointer events,
 * so clicks in empty space inside the bbox fall through to the objects
 * underneath; only a transparent hit path along the line — widened to
 * max(thickness, 2·STROKE_HIT_TOLERANCE_PX/zoom) world units, i.e. a screen
 * radius of max(thickness/2, STROKE_HIT_TOLERANCE_PX) — captures the click.
 */
import type { ObjectProps } from './registry';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';

export function StrokeObject({
  obj,
  z,
  zoom,
  selected,
  onPointerDown,
}: ObjectProps) {
  const stroke = obj as StrokeSnap;
  const x = stroke.x;
  const y = stroke.y;
  const width = stroke.width ?? 0;
  const height = stroke.height ?? 0;

  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const color = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;

  // The SVG is positioned at the bbox origin, so render the stored relative
  // points scaled to the current size in local coordinates.
  const sx = stroke.baseWidth > 0 ? width / stroke.baseWidth : 1;
  const sy = stroke.baseHeight > 0 ? height / stroke.baseHeight : 1;
  const pts: Point[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    pts.push({ x: stroke.points[i] * sx, y: stroke.points[i + 1] * sy });
  }
  const d = smoothPath(pts);
  if (d === '') return null;

  // Hit width in world units: screen radius max(thickness/2, 6px) → the
  // wider of the drawn line and the selection tolerance.
  const hitWidth = Math.max(thickness, (2 * STROKE_HIT_TOLERANCE_PX) / zoom);

  const handlePointerDown = (e: React.PointerEvent<SVGPathElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    onPointerDown(e, stroke.id);
  };

  return (
    <svg
      data-testid="stroke-object"
      data-stroke-id={stroke.id}
      data-selected={selected || undefined}
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: Math.max(width, 1),
        height: Math.max(height, 1),
        zIndex: z,
        overflow: 'visible',
        pointerEvents: 'none',
        touchAction: 'none',
      }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <path
        data-testid="stroke-hit-path"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        style={{ cursor: 'grab' }}
        onPointerDown={handlePointerDown}
      />
    </svg>
  );
}
