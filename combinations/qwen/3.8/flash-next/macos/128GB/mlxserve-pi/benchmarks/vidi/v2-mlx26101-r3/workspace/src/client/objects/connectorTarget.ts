import { CONNECTOR_TYPE, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Endpoint } from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import { boardRects } from '../../shared/objects/connector';
import { getObjectType } from './registry';

/**
 * The object a pointer is over, or `null` for the board itself.
 *
 * Asked of the topmost object down, because that is what a pointer is over: two shapes stacked and
 * the one on top is the one an arrow would be drawn to. The snapshot is in stacking order, so this
 * walks it backwards and stops at the first thing that contains the point.
 *
 * Two kinds are passed over. An arrow is one of them: its box is the rectangle around its two ends,
 * which contains a great deal of board that is not the arrow - and an arrow you could attach another
 * arrow to by aiming at the empty space inside it is an arrow that gets attached to by accident. The
 * registry decides the rest, per type: a sticky note is its square, a heading is its box, and a type
 * this build does not know has no box to be inside of.
 */
export function attachTargetAt(
  objects: readonly ObjectSnapshot[],
  world: Point,
): ObjectSnapshot | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object === undefined || object.type === CONNECTOR_TYPE) {
      continue;
    }
    const spec = getObjectType(object.type);
    if (spec === undefined) {
      continue;
    }
    if (spec.hitTest(object, world)) {
      return object;
    }
  }
  return null;
}

/**
 * Where an arrow's end would go if the pointer were let go here.
 *
 * On a thing, it is fastened to that thing and remembers the point only as a last resort; on nothing
 * at all, it is a point. The model is the one that decides which of the two an endpoint is and what
 * either is worth; this only says what was pointed at, and lets the fallback be the pointer's own
 * position because `createConnector` replaces it with the side the arrow actually left.
 */
export function endpointAt(objects: readonly ObjectSnapshot[], world: Point): Endpoint {
  const target = attachTargetAt(objects, world);
  if (target === null) {
    return { kind: 'free', x: world.x, y: world.y };
  }
  return { kind: 'attached', objectId: target.id, fallback: world };
}

/** Where everything on the board is, which is what `resolveEndpoints` and `endpointPoint` read. */
export function rectsOf(objects: readonly ObjectSnapshot[]): ReadonlyMap<string, Rect> {
  return boardRects(objects);
}

/** An object's box, for the callers that have one object rather than a map of them all. */
export function rectOf(object: ObjectSnapshot): Rect {
  return objectBounds(object);
}
