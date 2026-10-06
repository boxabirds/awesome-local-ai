/**
 * Which board objects an arrow may be tied to, and which one a point is on.
 *
 * One file answers the question twice-asked: the Connector tool needs it to know what to draw
 * dots on, and a dragged arrow end needs it to know what to tie itself to. Keeping it here
 * means the dot you were shown and the arrow you got are decided by the same code.
 *
 * The list is positive on purpose. A note, a piece of text and a shape are things with sides an
 * arrow can leave from; another arrow is not — it has no sides of its own, and an arrow pointing
 * at an arrow would have nowhere honest to put its end. Anything a later story adds is not a
 * target until someone says what its sides mean.
 */

import { STICKY_OBJECT_TYPE, type ObjectSnapshot } from '../../shared/board-model';
import { SHAPE_OBJECT_TYPE } from '../../shared/objects/shape';
import { TEXT_OBJECT_TYPE } from '../../shared/objects/text';
import type { Point } from '../../shared/geometry';
import { hitTestObject } from './registry';

export const CONNECTOR_TARGET_TYPES: readonly string[] = [STICKY_OBJECT_TYPE, TEXT_OBJECT_TYPE, SHAPE_OBJECT_TYPE];

/** Would an arrow be willing to point at this? */
export function isAttachTarget(object: ObjectSnapshot): boolean {
  return CONNECTOR_TARGET_TYPES.includes(object.type);
}

/**
 * The topmost object under `world`, or `null` for empty board.
 *
 * Topmost rather than first-found, because a person aiming at a shape sitting on top of a note
 * means the shape. The type answers whether the point is on it, so a shape's rectangle is the
 * rule here as it is everywhere else (`sel.pick`).
 */
export function attachTargetAt(
  objects: readonly ObjectSnapshot[],
  world: Point,
  zoom?: number
): ObjectSnapshot | null {
  let found: ObjectSnapshot | null = null;
  for (const object of objects) {
    if (!isAttachTarget(object)) continue;
    if (!found || (object.z ?? 0) >= (found.z ?? 0)) {
      if (hitTestObject(object, world, zoom)) found = object;
    }
  }
  return found;
}
