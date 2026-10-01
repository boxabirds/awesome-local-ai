/**
 * Registers the `stroke` object type. Imported once at application startup.
 */

import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../shared/config';
import { registerObjectType } from './registry';
import { StrokeObject } from './StrokeObject';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const snap = obj as unknown as StrokeSnap;
    if (snap.type !== 'stroke') return false;
    const pts = scaledPoints(snap);
    const dist = distanceToPolyline(pts, worldPoint);
    const halfThickness = PEN_THICKNESS_WORLD[snap.thickness] / 2;
    // Use zoom=1 for default tolerance; BoardViewport/selection code adjusts with actual zoom
    const tolerance = Math.max(halfThickness, STROKE_HIT_TOLERANCE_PX);
    return dist <= tolerance;
  },
});
