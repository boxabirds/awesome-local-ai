// Connector geometry: which side of a shape an arrow ends at, and how far a
// point is from a line.
//
// There is no routing here on purpose. An arrow between two shapes is a
// straight line between two points on their outlines, and every part of that is
// pure and unit-testable without a browser or a document.
import type { ConnectorSide } from '../config';
import type { Point, Rect } from '../geometry';

/** The four sides, in the order a clock would pass them. */
const SIDES: readonly ConnectorSide[] = ['top', 'right', 'bottom', 'left'];

/** Every side of a rect, in order. */
export function allSides(): readonly ConnectorSide[] {
  return SIDES;
}

/** The centre of a rect. */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Which side of `rect` faces `target`.
 *
 * The sides are the two bands a diagonal cuts the space into, and the diagonal
 * itself belongs to the side the clockwise turn reaches first — so a due-east
 * neighbour is the right side and a due-neighbourhood-of-45° one is decided the
 * same way on every client, which is the only way two screens can be said to
 * draw the same arrow.
 */
export function nearestSide(rect: Rect, target: Point): ConnectorSide {
  const centre = rectCenter(rect);
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  // Exactly on the centre there is no facing side; the right one is as good a
  // guess as any, and it is the same guess on every client.
  if (dx === 0 && dy === 0) return 'right';
  // Comparing the two ratios against the rect's own proportion is the diagonal,
  // stated without a divide by a side length that could be zero.
  if (Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * The point a connector ends at on `rect`'s outline for a given side: the
 * midpoint of that side.
 *
 * The midpoints are on the outline of a rectangle, of an ellipse and of a
 * diamond, which is why they are the anchors for all three shapes — an arrow
 * drawn to one of them touches the figure it is attached to, and does not have
 * to know which figure it is.
 */
export function sideAnchor(rect: Rect, side: ConnectorSide): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

/** The smallest axis-aligned rect that holds both points. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
