import type { Rect } from '../../src/shared/geometry';

/** A rectangle, spelled the way the tests read: `rect(x, y, width, height)`. */
export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}
