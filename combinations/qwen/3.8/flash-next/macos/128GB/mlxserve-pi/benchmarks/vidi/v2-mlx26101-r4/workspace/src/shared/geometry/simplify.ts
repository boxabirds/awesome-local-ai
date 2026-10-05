/**
 * Thinning a drawn path, splitting one that grew too big, and painting the result.
 *
 * Three small pieces of arithmetic that a pen needs and nothing else on the board uses. They are together
 * because they are three answers to one question — what to do with the few thousand points a tablet hands over
 * when somebody draws a circle — and in that order: {@link simplify} throws most of the points away,
 * {@link splitPoints} decides whether what is left fits into one object, {@link smoothPath} turns what is left
 * into something a browser can draw.
 *
 * **The points that are thrown away are the ones the line could have done without.** Ramer–Douglas–Peucker
 * works out what a path would look like if it were a straight line between its two ends; if the farthest point
 * from that line is close enough, the whole run between the ends *is* that line, as far as the screen is
 * concerned, and everything in the middle goes. If it is not, that farthest point is kept — it is the one point
 * that says something the ends do not — and the two halves are asked the same question. It is worth being clear
 * about what that guarantees and what it does not: it guarantees that no point the pen passed through ends up
 * farther from the finished line than the tolerance, and it does not guarantee any particular *number* of
 * points, which is the right way round for a drawing. A filter that kept every tenth point would be cheaper
 * and would cut off the corner of every zigzag.
 *
 * The tolerance is given in whatever unit the points are in. The pen works in board units and hands it
 * `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, because the tolerance a person means is measured on their screen.
 */
import type { Point } from '../geometry';
import { STROKE_MAX_POINTS } from '../config';

/** A point a browser can draw: two real numbers, which is less than half of what a pointer sometimes sends. */
function usable(point: unknown): point is Point {
  if (typeof point !== 'object' || point === null) return false;
  const candidate = point as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number' && Number.isFinite(candidate.y);
}

/** How far `point` is from the *infinite* line through `from` and `to`, perpendicular to it.
 *
 * The infinite line is the point: a point that sticks out past either end of the segment still says something
 * about where the pen went, and a distance measured to the segment would call it collinear and throw it away.
 * A zero-length segment — a pen that came down and came down again in the same place — has no line to be
 * measured against, so the distance is simply how far the point is from that place.
 */
function perpendicularDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  // The cross product over the length is the perpendicular distance; the parameter along the segment is not
  // needed, which is what makes this the distance to the line rather than to the segment.
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / Math.sqrt(length);
}

/**
 * Thin a drawn path to the points that carry the drawing, keeping the first and the last.
 *
 * The result is always a subsequence of the input, in order: nothing is averaged, moved or invented. That is
 * the property the smoothing requirement rests on — a stroke that was *re*derived into a smoother curve would
 * be a stroke that drifted from where the pen went, and a person who drew a tight corner would watch it arrive
 * rounded.
 *
 * `tolerance` is in the units of the points. Zero or less means "keep every point", which is what a caller that
 * has already thinned this path needs: re-thinning stored points on every render would slowly rewrite a
 * drawing every time somebody looked at it.
 *
 * A path of fewer than three points is returned as it came: there is nothing between the ends to judge. Points
 * that are not points (a `NaN` coordinate, which a pointer event can produce and a `Y.Map` will happily store)
 * are dropped first, because one of them in a path is not a rough drawing but a shape no browser will draw at
 * all.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const path = (Array.isArray(points) ? points : []).filter(usable);
  if (path.length < 3 || !(tolerance > 0)) return path.map((point) => ({ x: point.x, y: point.y }));

  // Iterative rather than recursive. RDP recurses once per point kept in the worst case, and a stroke is
  // allowed five thousand points: a stack overflow in the middle of a commit would lose the stroke, and losing
  // a drawing is a worse outcome than a few more points in the record.
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  const stack: number[] = [0, path.length - 1];
  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    if (last <= first + 1) continue;

    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(path[i]!, path[first]!, path[last]!);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }

    // Strictly greater, so a point exactly on the tolerance is kept: the choice only ever costs a point, and
    // the alternative throws away a point that is as far off the line as the drawing was allowed to be.
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1;
      stack.push(first, index, index, last);
    }
  }

  const thin: Point[] = [];
  for (let i = 0; i < path.length; i += 1) if (keep[i] === 1) thin.push({ x: path[i]!.x, y: path[i]!.y });
  return thin;
}

/**
 * Cut a path into pieces of at most `max` points, each piece starting where the one before ended.
 *
 * The shared point is the whole of the function. A record holds at most {@link STROKE_MAX_POINTS} points, so a
 * gesture longer than that has to become more than one; if the second piece simply started at the next point
 * the pen reached after the cut, there would be a gap between the two — a nick out of the drawing, at the one
 * place where the pen never left the board. Starting the next piece at the last point of the previous one costs
 * one stored point and makes the two meet.
 *
 * The pieces are not simplified: thinning is the caller's job, and a piece that had been thinned here would be
 * thinned again by a caller that did not know.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const path = (Array.isArray(points) ? points : []).filter(usable);
  if (path.length === 0) return [];
  // A limit of nothing is no limit. Without this the loop below would ask for a piece of no points, take none,
  // and go round again forever — which is how a bad setting becomes a hung tab.
  if (!(max >= 1)) return [path.map((point) => ({ x: point.x, y: point.y }))];

  const parts: Point[][] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + max - 1, path.length - 1);
    parts.push(path.slice(start, end + 1).map((point) => ({ x: point.x, y: point.y })));
    if (end >= path.length - 1) return parts;
    // Not `end + 1`: the last point of this piece is the first point of the next.
    start = end;
  }
}

/**
 * A number for path data, rounded to a hundredth of a board unit.
 *
 * Path data is written out again on every render of every stroke on the board, and a point that came through
 * `screenToWorld` carries seventeen decimals of arithmetic nobody can see. Rounding to a hundredth costs
 * nothing visible — a hundredth of a pixel at 100%, a hundredth of a *pixel* at 400% because the whole path is
 * scaled — and keeps the attribute a browser has to parse small enough to be worth parsing.
 */
function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  // `-0` prints as `-0` in some engines' `String`, and `M-0 0` is not a thing.
  return rounded === 0 ? '0' : String(rounded);
}

/**
 * The path data for a drawn line: starting where the pen came down, curving through the rest.
 *
 * Quadratic Béziers through the *midpoints* of consecutive segments, with the segment's own point as the
 * control point. This is the classic smoothing of a sampled gesture, and the reason it is used here is that it
 * cannot misbehave: each curve starts and ends on points of the drawn polyline and is held inside the little
 * triangle between them, so the painted line is never far from the line that was drawn — a fraction of a
 * segment, on top of the simplifier's tolerance. A spline that overshot (a Catmull–Rom through the same
 * points) would draw a stroke that waved where the pen went straight.
 *
 * The first segment is the line from the pen's first touch to the first midpoint; the last one ends exactly on
 * the last point, because a stroke that stopped a fraction of a segment short of where the pen lifted would
 * have a stub missing from the end of every drawing.
 *
 * One point answers a zero-length segment at that point, which a `stroke-linecap: round` paints as a dot the
 * width of the pen — that is how a tap becomes a dot, with nothing special about it. No points answers the
 * empty path, which is a path that draws nothing rather than a `d` attribute of `"NaN"`, which is a path a
 * browser refuses to parse.
 */
export function smoothPath(points: readonly Point[]): string {
  const path = (Array.isArray(points) ? points : []).filter(usable);
  if (path.length === 0) return '';

  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (path.length === 1) return `M ${n(first.x)} ${n(first.y)}L ${n(last.x)} ${n(last.y)}`;

  const parts: string[] = [`M ${n(first.x)} ${n(first.y)}`];
  if (path.length === 2) {
    parts.push(`L ${n(last.x)} ${n(last.y)}`);
    return parts.join(' ');
  }

  for (let i = 1; i < path.length - 1; i += 1) {
    const control = path[i]!;
    const next = path[i + 1]!;
    parts.push(`Q ${n(control.x)} ${n(control.y)} ${n((control.x + next.x) / 2)} ${n((control.y + next.y) / 2)}`);
  }
  parts.push(`L ${n(last.x)} ${n(last.y)}`);
  return parts.join(' ');
}
