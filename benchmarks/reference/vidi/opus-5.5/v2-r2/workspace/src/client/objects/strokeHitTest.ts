import type { ObjectSnapshot } from '../../shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { isStroke, scaledPoints } from '../../shared/objects/stroke';

/**
 * Registry hit test for strokes (pen.select): within max(thickness / 2,
 * STROKE_HIT_TOLERANCE_PX / zoom) world units of the line. Inside the stroke's
 * box but farther from the line is a miss.
 */
export function strokeHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!isStroke(obj)) return false;
  const tolerance = Math.max(PEN_THICKNESS_WORLD[obj.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  return distanceToPolyline(scaledPoints(obj), p) <= tolerance;
}
