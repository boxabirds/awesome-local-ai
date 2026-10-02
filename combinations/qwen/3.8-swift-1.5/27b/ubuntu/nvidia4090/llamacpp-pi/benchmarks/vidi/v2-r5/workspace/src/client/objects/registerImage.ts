// src/client/objects/registerImage.ts
// Registers the image object type in the registry.

import { registerObjectType } from './registry';
import { ImageObject } from './ImageObject';
import { IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

function bboxHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const width = (obj as any).width ?? 0;
  const height = (obj as any).height ?? 0;
  return (
    worldPoint.x >= obj.x &&
    worldPoint.x <= obj.x + width &&
    worldPoint.y >= obj.y &&
    worldPoint.y <= obj.y + height
  );
}

registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: bboxHitTest,
});
