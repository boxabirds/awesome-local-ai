/**
 * Test-only object type: resizable, not aspect-locked, minSize 10.
 * Imported only by tests to prove the registry and transform gesture are generic.
 */
import React from 'react';
import { registerObjectType } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';

registerObjectType('testbox', {
  Component: () => null,
  resizable: true,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});
