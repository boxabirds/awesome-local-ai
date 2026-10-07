import { objectBounds, type ObjectSnapshot, type Point } from '../../shared/board-model.js';
import { CONNECTOR_TYPE } from '../../shared/objects/connector.js';

/**
 * Which object a point is over (`src/client/tools/objectAtPoint.ts`).
 *
 * A bounding box, topmost first - the same test the marquee makes and the same
 * `objectBounds` the renderer draws from, so the object a tool attaches an arrow to
 * is the object a person sees under their pointer. Arrows are skipped: an arrow is
 * picked by how near its *line* a click was (`connector.select`), never by the box
 * around it, and letting one be an arrow's target would put an arrow on the end of
 * an arrow.
 *
 * It works on the snapshot rather than on the DOM (`elementFromPoint`) on purpose: a
 * component test has no layout to ask, and a rule that needs layout to work is a
 * rule nobody can test.
 */
export function objectAtPoint(
  snapshot: readonly ObjectSnapshot[],
  point: Point,
): ObjectSnapshot | null {
  let found: ObjectSnapshot | null = null;
  for (const object of snapshot) {
    if (object.type === CONNECTOR_TYPE) continue;
    const rect = objectBounds(object);
    if (point.x < rect.x || point.x > rect.x + rect.width) continue;
    if (point.y < rect.y || point.y > rect.y + rect.height) continue;
    // The last one wins in drawing order, which is the one the pointer reaches.
    if (found === null || object.z >= found.z) found = object;
  }
  return found;
}

export default objectAtPoint;
