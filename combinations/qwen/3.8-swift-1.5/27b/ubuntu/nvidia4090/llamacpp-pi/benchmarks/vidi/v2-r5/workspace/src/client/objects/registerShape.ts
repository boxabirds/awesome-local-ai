// src/client/objects/registerShape.ts
// Registers the shape type in the object registry.

import { registerObjectType, type ObjectTypeSpec } from './registry';
import { ShapeObject } from './ShapeObject';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

function shapeHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

let registered = false;

export function _registerShapeComponent(): void {
  if (registered) return;
  registered = true;

  const spec: ObjectTypeSpec = {
    Component: ShapeObject,
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: shapeHitTest,
  };

  registerObjectType('shape', spec);
}

// Auto-register on import
_registerShapeComponent();
