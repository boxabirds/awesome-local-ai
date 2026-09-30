import { type ObjectSnapshot, objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import type { Point as ScreenPoint } from '../canvas/camera';
import { getObjectType } from './registry';

/**
 * The topmost object an arrow can attach to at `world` (every registered type
 * except connectors), skipping `exclude`. Uses each type's registry hit test.
 */
export function attachableObjectAt(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
  zoom: number,
  exclude?: ReadonlySet<string>,
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i]!;
    if (o.type === 'connector' || exclude?.has(o.id)) continue;
    const spec = getObjectType(o.type);
    if (spec?.hitTest(o, world, zoom)) return o;
  }
  return null;
}

/** Rects of every object an arrow can attach to, by id (as `objectRects` for a snapshot). */
export function attachableRects(snapshot: readonly ObjectSnapshot[]): Map<string, Rect> {
  return new Map(snapshot.filter((o) => o.type !== 'connector').map((o) => [o.id, objectBounds(o)]));
}

/** A client point relative to the board viewport containing `el` (screen space of the camera). */
export function viewportPoint(el: Element, clientX: number, clientY: number): ScreenPoint {
  const viewport = el.closest('[data-testid="board-viewport"]') ?? el;
  const rect = viewport.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
