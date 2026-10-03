// Which object is under a point, for the two story 10 tools.
//
// Both tools put a layer over the board, so while one of them is held the objects
// underneath never receive the press — the browser's own hit-testing is out of reach and
// the DOM cannot answer "what is under the pointer". The answer comes from the data
// instead: the same boxes story 7 selects and moves by, tested against the world point the
// pointer is over, topmost first.
//
// "Topmost" is the object with the highest `z`, and between equal `z` values the one made
// later — the order the world layer paints them in, so what a person sees on top is what a
// press gets.

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

function holds(rect: { x: number; y: number; width: number; height: number }, p: Point): boolean {
  return (
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
  );
}

/**
 * The object on top of `world`, or null when the point is on the board itself.
 *
 * An arrow is never the answer. Its box is the box of a line: most of it is empty board, and
 * a box test that answered "the arrow" would let a press in mid-air join to an arrow nobody
 * aimed at (connector.select). What belongs to an arrow is its line plus a screen allowance,
 * and the code that wants that measures the line — `hitTest` on the object, or the
 * Connector tool's own reading of it.
 */
export function topObjectAt(
  objects: readonly ObjectSnapshot[],
  world: Point,
): ObjectSnapshot | null {
  let best: ObjectSnapshot | null = null;
  for (const obj of objects) {
    if (obj.type === 'connector') continue;
    if (!holds(objectBounds(obj), world)) continue;
    if (
      !best ||
      obj.z > best.z ||
      (obj.z === best.z && obj.createdAt >= best.createdAt)
    ) {
      best = obj;
    }
  }
  return best;
}

/** The id of the object on top of `world`, or null. */
export function topObjectIdAt(objects: readonly ObjectSnapshot[], world: Point): string | null {
  return topObjectAt(objects, world)?.id ?? null;
}
