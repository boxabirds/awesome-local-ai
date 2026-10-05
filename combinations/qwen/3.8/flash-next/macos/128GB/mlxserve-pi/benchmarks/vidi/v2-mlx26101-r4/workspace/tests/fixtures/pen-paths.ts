/**
 * Handwritten paths, as a pen leaves them (story 11's fixtures).
 *
 * Story 11's tests are all about *a path somebody drew*: that thinning it keeps the shape of it, that four
 * hundred points along a hand-wound loop are still a loop, that a line of a hundred points becomes two. A
 * fixture of two points cannot answer any of that, and a fixture of a thousand arbitrary numbers cannot be
 * read. So these are the shapes a hand actually makes — a loop, an underline, a letter, a zigzag, a spiral —
 * written down the way a tablet writes them down: an array of points, dense enough that one letter costs a
 * hundred of them.
 *
 * **They are generated, and generated deterministically.** A recording of a real stylus is a few thousand
 * numbers in a file nobody can review, that changes when somebody records it again. What these are is the
 * same thing with the numbers derived from a seeded generator instead of from a hand: the seed is fixed, so
 * a path is the same number on every machine and in every run — which a test that counts the points a
 * simplifier kept has to be able to rely on — and the jitter is real, so no path is ever perfectly straight
 * and the simplifier cannot pass a test by accident that a straight line would have passed for free.
 *
 * Everything is in board units at 100%, where a board unit and a screen pixel are the same thing. A jitter of
 * 0.4 is therefore 0.4 of a pixel, and a test that works at another zoom divides by the zoom, exactly as the
 * pen does.
 */
import type { Point } from '../../src/shared/geometry';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
// The story 10 distance function, which is what the smoothing promise below is measured with — and what the
// board's own hit test is measured with, so a fixture and a product answer cannot drift apart.
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

/**
 * A small deterministic generator (mulberry32), seeded by hand below. Those seeds are the recording: changing
 * one changes every path that follows it, which is the price of not storing the numbers themselves.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A path with `jitter` of wobble added to every point, in both axes.
 *
 * This is what makes a fixture a recording rather than a formula: a path produced out of `Math.sin` alone is
 * perfectly smooth, and a simplifier can look clever against a perfect curve for reasons that have nothing to
 * do with a pen.
 */
export function wobble(points: readonly Point[], jitter: number, seed = 1): Point[] {
  const random = seeded(seed);
  return points.map((point) => ({
    x: point.x + (random() - 0.5) * jitter * 2,
    y: point.y + (random() - 0.5) * jitter * 2,
  }));
}

/** `count` points along a straight line, as evenly spaced as a pen ever manages. */
export function straightRun(count: number, from: Point, to: Point): Point[] {
  return Array.from({ length: count }, (_unused, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
}

/**
 * The handwritten loop of the design's fixture: a circle wound by hand, ~400 points, closed by eye.
 *
 * Closed *by eye* and not at all: the last point falls a little short of the first, because that is what a
 * hand does, and a simplifier that assumed a closed curve would fail on it. This is the path the smoothing
 * tests run on, because it is the path a person actually draws when they mean "circle" — many points, few of
 * them saying anything the two beside them had not already said.
 */
export function handwrittenLoop(options: { count?: number; radius?: number; x?: number; y?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { count = 400, radius = 110, x = 220, y = 180, jitter = 0.7, seed = 17 } = options;
  const points = Array.from({ length: count }, (_unused, index) => {
    // Four and a half turns of a circle that is not quite a circle: the radius breathes as the hand goes
    // round, which is what makes the result a loop and not a compass drawing.
    const turn = (index / (count - 1)) * Math.PI * 2 * 0.99;
    const reach = radius + Math.sin(turn * 3) * 6 + Math.cos(turn * 5) * 3;
    return { x: x + Math.cos(turn) * reach, y: y + Math.sin(turn) * reach * 0.86 };
  });
  return wobble(points, jitter, seed);
}

/**
 * An underline: ~120 points over a line a hand went along.
 *
 * The other half of the pairing above. A loop is all curve, and a simplifier has to keep most of it; an
 * underline is nearly all straight, and a simplifier should be rid of nearly all of it. A test that only ever
 * ran the loop would pass for a simplifier that did nothing at all.
 */
export function underline(options: { count?: number; x?: number; y?: number; length?: number; rise?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { count = 120, x = 40, y = 320, length = 380, rise = 6, jitter = 0.35, seed = 7 } = options;
  const points = Array.from({ length: count }, (_unused, index) => {
    const t = index / (count - 1);
    // A line drawn with the wrist rises a little on the way, which is the only curve in it.
    return { x: x + length * t, y: y - Math.sin(t * Math.PI) * rise };
  });
  return wobble(points, jitter, seed);
}

/** A shaky straight line, the shortest thing a pen ever leaves behind. */
export function shakyLine(count = 200, from: Point = { x: 0, y: 0 }, to: Point = { x: 400, y: 0 }, jitter = 0.35, seed = 7): Point[] {
  return wobble(straightRun(count, from, to), jitter, seed);
}

/**
 * A sine wave, sampled `count` times: a curve, so the simplifier has to keep points rather than drop them.
 *
 * The distinction is the whole of why the tolerance is a tolerance and not a target count: the thinning that
 * takes ninety per cent out of a straight run can only take a little out of a wave, because every point on a
 * wave says something its neighbours did not.
 */
export function noisySine(options: { count?: number; x?: number; y?: number; width?: number; amplitude?: number; waves?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { x = 0, y = 100, width = 600, amplitude = 60, waves = 3, jitter = 0.4, seed = 11 } = options;
  const count = options.count ?? 300;
  const points = Array.from({ length: count }, (_unused, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return { x: x + width * t, y: y + Math.sin(t * Math.PI * 2 * waves) * amplitude };
  });
  return wobble(points, jitter, seed);
}

/**
 * A zigzag: straight runs joined by sharp corners, which is the hardest thing a simplifier is asked about.
 *
 * The points along a run are repetition and the points at the corners are the drawing. Get this right and the
 * corners are all that is left; get the tolerance wrong and either a corner goes missing — the drawing
 * changes — or the run stays, and a line somebody drew with two points is stored with four hundred.
 */
export function zigzag(options: { corners?: number; perRun?: number; step?: number; drop?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { corners = 6, perRun = 24, step = 60, drop = 40, jitter = 0.3, seed = 3 } = options;
  const points: Point[] = [{ x: 0, y: 0 }];
  for (let corner = 0; corner < corners; corner += 1) {
    const from = points[points.length - 1]!;
    const to = { x: from.x + step, y: from.y + (corner % 2 === 0 ? drop : -drop) };
    points.push(...straightRun(perRun, from, to).slice(1));
  }
  return wobble(points, jitter, seed);
}

/**
 * A spiral, the way a hand winds one: many turns, each a little tighter than the last.
 *
 * Long by construction, because a stroke has to be able to be longer than anything else on the board —
 * {@link longSpiral} runs past {@link STROKE_MAX_POINTS} on purpose, so the tests can see what the pen does
 * when one gesture outgrows the record.
 */
export function spiral(options: { turns?: number; perTurn?: number; radius?: number; x?: number; y?: number; jitter?: number; seed?: number } = {}): Point[] {
  const { turns = 6, perTurn = 90, radius = 120, x = 200, y = 200, jitter = 0.5, seed = 5 } = options;
  const count = Math.max(1, Math.round(turns * perTurn));
  const points = Array.from({ length: count }, (_unused, index) => {
    const angle = (index / (perTurn - 1)) * Math.PI * 2;
    // Each turn is wound in a little: the distance between successive points shrinks as the pen comes home.
    const reach = radius * (1 - index / (count * 1.6));
    return { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach };
  });
  return wobble(points, jitter, seed);
}

/**
 * A spiral of {@link STROKE_MAX_POINTS} + 10 points: one gesture more than a stroke can hold.
 *
 * The count is derived from the setting rather than written out, so this fixture keeps meaning "ten points
 * more than the record" if the record ever gets longer — which is the only way a fixture about a limit stays
 * a fixture about that limit.
 */
export function longSpiral(extra = 10): Point[] {
  const wanted = STROKE_MAX_POINTS + extra;
  const points: Point[] = [];
  // Wound in turns of ninety, because that is the density of the fixture above; the tail is a straight run,
  // which is where a pen that has run out of spiral goes.
  const turns = Math.floor(wanted / 90);
  for (let turn = 0; turn < turns; turn += 1) {
    points.push(...spiral({ turns: 1, perTurn: 90, radius: 130 - turn * 3, x: 200 + turn * 6, y: 200, seed: 100 + turn }));
  }
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  points.push(...straightRun(wanted - points.length, last, { x: last.x + 20, y: last.y - 20 }));
  return points.slice(0, wanted);
}

/**
 * The letter A, as three strokes of a pen: two diagonals and a crossbar.
 *
 * Three strokes, because a letter is the clearest statement of the thing story 11 has to get right: a hand
 * lifts the pen between them, and a lifted pen ends one stroke and starts the next. Stored as one path, this
 * would be an A with a line drawn back up its left leg — the mistake a drawing format that does not know
 * about lifts makes.
 */
export function letterA(scale = 1, jitter = 0.4): Point[] {
  return [...letterAStrokes(scale, jitter)].flat();
}

/** The same letter, kept apart by the lifts: one entry of the result per stroke the pen commits. */
export function letterAStrokes(scale = 1, jitter = 0.4): Point[][] {
  const parts: [Point, Point, number, number][] = [
    [{ x: 0, y: 160 }, { x: 70, y: 0 }, 60, 23],
    [{ x: 70, y: 0 }, { x: 140, y: 160 }, 60, 24],
    [{ x: 35, y: 96 }, { x: 105, y: 96 }, 40, 25],
  ];
  return parts.map(([from, to, count, seed]) =>
    wobble(straightRun(count, scaled(from, scale), scaled(to, scale)), jitter, seed),
  );
}

function scaled(point: Point, scale: number): Point {
  return { x: point.x * scale, y: point.y * scale };
}

/** The first point of a path. */
export function firstOf(path: readonly Point[]): Point {
  const point = path[0];
  if (point === undefined) throw new Error('an empty path has no first point');
  return point;
}

/** The last point of a path — where a pen that ran out of record goes on from. */
export function lastOf(path: readonly Point[]): Point {
  const point = path[path.length - 1];
  if (point === undefined) throw new Error('an empty path has no last point');
  return point;
}

/** How many points a path holds. Named, because `points.length` in a test reads like a mistake. */
export function count(path: readonly Point[]): number {
  return path.length;
}

/** Whether this exact point is one of the ones that were drawn (by coordinates, not by identity). */
export function holds(path: readonly Point[], point: Point): boolean {
  return path.some((entry) => entry.x === point.x && entry.y === point.y);
}

/** The box a path fits in, with no padding in it: the drawing's own extent. */
export function extent(path: readonly Point[]): { x: number; y: number; width: number; height: number } {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * How far the drawn path is from the path it was thinned to, in board units.
 *
 * This is the promise smoothing makes: every point the pen passed through is *near* the finished line — never
 * farther than the tolerance, which is why the tolerance is in pixels and why the tests can say what "the same
 * drawing, fewer points" means to within a number.
 */
export function maxDeviation(drawn: readonly Point[], thin: readonly Point[]): number {
  let worst = 0;
  for (const point of drawn) worst = Math.max(worst, distanceToPolyline(thin, point));
  return worst;
}
