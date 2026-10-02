// src/client/objects/registerStroke.ts
// Registers the stroke type in the object registry.

import { registerObjectType, type ObjectTypeSpec } from './registry';
import { StrokeObject } from './StrokeObject';
import { scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import {
  STROKE_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

let registered = false;

export function _registerStrokeComponent(): void {
  if (registered) return;
  registered = true;

  const spec: ObjectTypeSpec = {
    Component: StrokeObject,
    resizable: true,
    aspectLocked: true,
    minSize: STROKE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: (obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean => {
      const s = obj as unknown as StrokeSnap;
      const pts = scaledPoints(s);
      const dist = distanceToPolyline(pts, worldPoint);
      const z = zoom ?? 1;
      const tolerance = Math.max(
        PEN_THICKNESS_WORLD[s.thickness] / 2,
        STROKE_HIT_TOLERANCE_PX / z,
      );
      return dist <= tolerance;
    },
  };

  registerObjectType('stroke', spec);
}

// Auto-register on import
_registerStrokeComponent();
