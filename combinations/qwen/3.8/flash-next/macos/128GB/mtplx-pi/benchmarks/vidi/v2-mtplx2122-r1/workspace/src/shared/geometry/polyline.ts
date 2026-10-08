import type { Point } from './types'

/**
 * Shortest distance from a point `p` to a polyline given by an ordered list of
 * points. With fewer than two points there is no segment: a single point
 * returns its direct distance and an empty list returns `Infinity`.
 *
 * Reused by story 11 (freehand ink hit-testing) and story 10 (connector line
 * selection): the click tolerance is `distanceToPolyline(ends, p)`.
 */
export function distanceToPolyline(pts: readonly Point[], p: Point): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return dist(pts[0], p)

  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i], pts[i + 1], p)
    if (d < min) min = d
  }
  return min
}

function dist(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function distanceToSegment(a: Point, b: Point, p: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y

  const lenSq = vx * vx + vy * vy
  if (lenSq === 0) return dist(a, p)

  // Projection factor clamped to the segment.
  let t = (wx * vx + wy * vy) / lenSq
  if (t < 0) t = 0
  else if (t > 1) t = 1

  const px = a.x + t * vx
  const py = a.y + t * vy
  const dx = p.x - px
  const dy = p.y - py
  return Math.sqrt(dx * dx + dy * dy)
}
