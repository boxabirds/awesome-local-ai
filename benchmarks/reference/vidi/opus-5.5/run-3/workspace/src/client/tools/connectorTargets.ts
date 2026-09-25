// Finding the object an arrow end would attach to (Connector tool and arrow end handles).
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

/** The topmost object under a world point that an arrow can attach to (any object but an arrow), or null. */
export function attachTargetAt(
  objects: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
  exclude?: ReadonlySet<string>,
): ObjectSnapshot | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type === 'connector' || exclude?.has(o.id)) continue;
    const spec = getObjectType(o.type);
    if (spec?.hitTest(o, p, zoom)) return o;
  }
  return null;
}

export function rectOf(o: ObjectSnapshot): Rect {
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}
