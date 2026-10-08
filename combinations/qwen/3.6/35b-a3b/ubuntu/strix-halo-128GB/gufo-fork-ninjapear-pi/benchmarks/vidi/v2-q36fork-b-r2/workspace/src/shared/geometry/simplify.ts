import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/**
 * Ramer-Douglas-Peucker line simplification (iterative, no recursion risk).
 * Keeps first and last points guaranteed.
 * @param points - input polyline points in world units
 * @param tolerance - maximum allowed deviation per point
 * @returns simplified point array where every original point lies within `tolerance` of the output path
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) {
    return [...points];
  }

  // Iterative RDP using an explicit stack of [startIdx, endIdx] intervals
  const stack: [number, number][] = [[0, points.length - 1]];
  const keep = new Set<number>();
  keep.add(0);
  keep.add(points.length - 1);

  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx - startIdx < 1) continue;

    // Find the point with maximum distance from the line segment (start, end)
    let maxDist = 0;
    let maxIdx = -1;

    const ax = points[startIdx].x;
    const ay = points[startIdx].y;
    const bx = points[endIdx].x;
    const by = points[endIdx].y;

    for (let i = startIdx + 1; i < endIdx; i++) {
      const dist = perpendicularDistance(points[i], { x: ax, y: ay }, { x: bx, y: by });
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance && maxIdx >= 0) {
      keep.add(maxIdx);
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  // Collect kept points in order
  const sorted = [...keep].sort((a, b) => a - b);
  return sorted.map((i) => points[i]);
}

/**
 * Calculate perpendicular distance from point p to line segment ab.
 */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point — return distance from p to a
    const pdx = p.x - a.x;
    const pdy = p.y - a.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Project p onto the infinite line through a,b, clamp to segment
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const pdx = p.x - projX;
  const pdy = p.y - projY;
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

/**
 * Split a point array into chunks of at most `max` points.
 * Consecutive parts share their join point so they connect seamlessly.
 * The first chunk has up to `max` points. Each subsequent chunk starts
 * by repeating the last point of the previous chunk, then adds up to
 * `max - 1` new points (so each part has at most `max` total).
 *
 * @param points - input points
 * @param max - maximum points per part (default STROKE_MAX_POINTS)
 * @returns array of point arrays that cover the same path
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= 0) return [];
  if (points.length <= max) return [Array.from(points)];

  const parts: Point[][] = [];
  let offset = 0;

  // First chunk: up to `max` points starting from offset 0
  parts.push(Array.from(points.slice(0, max)));
  offset += max;

  // Remaining chunks: prepend the last point of the previous chunk
  // to share the join point, then add up to max-1 new points
  while (offset < points.length) {
    const prevLast = parts[parts.length - 1][parts[parts.length - 1].length - 1];
    const newPts = points.slice(offset, offset + max - 1);
    offset += max - 1;
    const part = [prevLast, ...newPts];
    parts.push(part);
  }

  return parts;
}

/**
 * Generate an SVG path string using quadratic Bézier curves through midpoints.
 * For a single point, returns a zero-length M-only path (renders as a dot via round cap).
 * Each curve passes through the midpoint of consecutive segments, staying inside their hull.
 *
 * @param points - simplified stroke points in world coordinates
 * @returns SVG path `d` attribute string
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Midpoint between prev and current
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += `Q${prev.x},${prev.y} ${midX},${midY}`;

    // If not the last point, add a line from midpoint to the actual next point
    if (i < points.length - 1) {
      d += `L${midX},${midY}`;
    } else {
      // Last segment: Q ends at midpoint, but we want to end at curr
      // Override: replace the last Q with one ending at curr
      // The pattern is M p0 Q p1 mid(p1,p2) L mid(p1,p2) Q p2 mid(p2,p3) ...
      // For the final point, just draw directly to it
      d = d.replace(/Q[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]$/, '');
      d += `L${curr.x},${curr.y}`;
    }
  }

  return d;
}
