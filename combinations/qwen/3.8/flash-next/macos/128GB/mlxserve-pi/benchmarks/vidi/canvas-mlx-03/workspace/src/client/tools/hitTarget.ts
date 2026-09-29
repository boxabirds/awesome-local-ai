// What object is under a board point (story 10 `connector.ui`).
//
// Both halves of the connector interaction ask this one question: the tool, to decide
// what the pointer is hovering over and what a release would weld an end to, and a
// selected arrow, to decide the same about its dragged end handle. The answer comes from
// the object registry, so an arrow can be attached to whatever object types exist — the
// sticky note of story 2, the text of story 9, the shape of this story and the frame of
// story 12 — without this file knowing any of their shapes. Each type answers for
// itself: a frame hits its border, a shape its bounding box, an arrow its line.
//
// The topmost object wins, because that is what a click would land on: the snapshot is
// in stacking order, so it is walked backwards. An arrow is never a target (two arrows
// joined by an arrow is not a flow chart), and neither is the arrow asking the question.

import { type ObjectSnapshot } from '../../shared/board-model.ts';
import { objectRectsOf } from '../../shared/objects/connector.ts';
import type { Point, Rect } from '../../shared/geometry.ts';
import { getObjectType } from '../objects/registry.tsx';

/** The object type an end can never be welded to: another arrow. */
const NOT_A_TARGET = 'connector';

export interface HitTargetOptions {
  /** Camera zoom, handed to the hit tests that need it (an arrow's click tolerance). */
  zoom?: number;
  /** The live rectangles, as the board builds them per render. */
  rects?: ReadonlyMap<string, Rect>;
  /** This object's own id: an arrow is not its own target. */
  except?: string;
}

/** The object under a point, with its current rectangle. */
export interface HitTarget {
  id: string;
  type: string;
  rect: Rect;
}

/**
 * The topmost object `point` is on, or null over empty board. Objects nothing has
 * registered are skipped: an object the build cannot draw is not something an end can
 * attach to.
 */
export function hitObjectAt(
  objects: readonly ObjectSnapshot[],
  point: Point,
  options: HitTargetOptions = {},
): HitTarget | null {
  if (!point) return null;
  const rects = options.rects ?? objectRectsOf(objects);
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.type === NOT_A_TARGET || o.id === options.except) continue;
    const spec = getObjectType(o.type);
    if (!spec) continue;
    if (!spec.hitTest(o, point, options.zoom ?? 1, rects)) continue;
    const rect = rects.get(o.id);
    if (!rect) continue;
    return { id: o.id, type: o.type, rect };
  }
  return null;
}
