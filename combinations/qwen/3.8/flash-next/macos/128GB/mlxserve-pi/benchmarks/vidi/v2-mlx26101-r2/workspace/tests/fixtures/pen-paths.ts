/**
 * Lines somebody would draw (`tests/fixtures/pen-paths.ts`, story 11).
 *
 * A stroke is the first object on this board whose test data cannot be a number. A
 * sticky note is tested with a position and a size; a squiggle has to be tested *as a
 * squiggle*, and a path typed by hand into a test file is three things at once - the
 * gesture, the expected geometry and the thing being looked at - which is how a test
 * of a drawn line ends up asserting a shape it made up rather than a shape it drew.
 * So the paths live here, named, and a test says "the circle" and means this one.
 *
 * Two rules keep them honest across the two suites that share them:
 *
 * - **they are in screen pixels, not board units.** A test's drag is a pointer gesture,
 *   and the pointer lives on the screen; a path written in board units would have to be
 *   converted by every test that used it, and the conversion is where a mistake would
 *   hide. `screenOf`/`worldOfScreen` in the component helpers and the page's own camera
 *   do the converting where it belongs.
 * - **they fit inside the default view.** All of them sit in the middle 400x320 of a
 *   1280x800 board at 100% with the standard camera, so a test that does not move the
 *   camera can use them as they are, and a test that does move the camera says so and
 *   converts them.
 *
 * They are hand-made rather than random on purpose: `pen.smooth` and `pen.long_stroke`
 * are both about *how many points survive*, and a random path has a point count that
 * changes with the seed, which would make the assertion about the simplifier a
 * assertion about the seed.
 */

import type { Point } from '../../src/client/canvas/camera.js';

/** A point, spelled the way a path spells it. */
export type Path = readonly Point[];

/** The point a path is drawn around: the middle of the default view. */
export const PATH_CENTRE: Point = { x: 640, y: 400 };

/**
 * A zigzag: seven points, alternating up and down, 440 px wide.
 *
 * Every one of its points is a corner, and the perpendicular distance of a corner from
 * the line its neighbours would suggest is large - so a zigzag is the path that proves
 * the simplifier is not simply throwing points away (`pen.smooth`): an eight-point
 * zigzag simplified at one pixel keeps all of them.
 */
export const zigzag: Path = [
  { x: 420, y: 460 },
  { x: 490, y: 340 },
  { x: 560, y: 460 },
  { x: 630, y: 340 },
  { x: 700, y: 460 },
  { x: 770, y: 340 },
  { x: 840, y: 460 },
];

/**
 * A circle: one hundred and twenty points on a 90 px radius, closed to within a fraction
 * of a point.
 *
 * The count is the point. A drag of a second around a circle is not twenty-four samples
 * - a mouse reports every eight milliseconds or so, and reports them in the dozens when
 * it moves fast - and a fixture that is too sparse for what a pointer really delivers
 * cannot test a simplifier at all: at twenty-four samples the points on a 90 px circle
 * are further from each other's chords than the one-pixel tolerance ever is, and the
 * answer to "does this thin the trail?" would be "no", for a reason that has nothing to
 * do with the algorithm.
 *
 * It is also the path that proves a click inside a loop is a click on what the loop is
 * drawn around (`pen.select`): its middle is empty, and 90 px from its own ink.
 */
export const circle: Path = densify(pathOnCircle(90, 24), 5);

/**
 * A scribble: a lopsided loop that crosses itself, sampled as a hand delivers it.
 *
 * The circle is too good a shape to test a selection with - its extremes are exactly
 * where a circle's are - and a zigzag is not closed. This is the shape a hand actually
 * makes: it goes out, comes back, crosses over itself twice, and ends somewhere other
 * than where it started. The turns are the eleven places a curve changes its mind, and
 * the points between them are the ones a simplifier is allowed to take away.
 */
export const scribble: Path = densify(
  [
    { x: 500, y: 380 },
    { x: 528, y: 330 },
    { x: 580, y: 300 },
    { x: 640, y: 296 },
    { x: 700, y: 314 },
    { x: 742, y: 356 },
    { x: 756, y: 410 },
    { x: 736, y: 460 },
    { x: 690, y: 492 },
    { x: 630, y: 500 },
    { x: 570, y: 486 },
    { x: 528, y: 452 },
    { x: 508, y: 410 },
    { x: 520, y: 366 },
    { x: 566, y: 340 },
    { x: 622, y: 336 },
    { x: 674, y: 356 },
    { x: 704, y: 396 },
    { x: 700, y: 440 },
    { x: 660, y: 466 },
    { x: 610, y: 468 },
    { x: 566, y: 444 },
    { x: 548, y: 404 },
    { x: 566, y: 368 },
    { x: 610, y: 356 },
    { x: 654, y: 372 },
    { x: 672, y: 408 },
    { x: 656, y: 436 },
    { x: 620, y: 444 },
    { x: 588, y: 424 },
    { x: 582, y: 396 },
    { x: 600, y: 378 },
    { x: 626, y: 384 },
    { x: 638, y: 408 },
    { x: 626, y: 424 },
    { x: 604, y: 418 },
    { x: 598, y: 400 },
    { x: 610, y: 392 },
    { x: 624, y: 400 },
    { x: 622, y: 412 },
    { x: 610, y: 412 },
  ],
  6,
  2,
);

/**
 * A long line: 5 001 points along a shallow diagonal, more than one stroke may hold
 * (`STROKE_MAX_POINTS` is 5 000). The count is the fixture, and it is spelled out by
 * construction rather than stored, because the assertion is about the number.
 */
export const longLine: Path = Array.from({ length: 5001 }, (_unused, index) => ({
  x: 320 + index * 0.12,
  y: 300 + index * 0.05,
}));

/** One point, and nothing else: what a press and a release in the same place is. */
export const dot: Path = [{ x: 640, y: 400 }];

/** Every named path, by the name a test calls it by. */
export const PEN_PATHS: Record<string, Path> = { zigzag, circle, scribble, dot };

/**
 * `n` points on a circle of `radius`, starting at the top and going clockwise, the last
 * one just short of the first - because a hand does not come back to where it started.
 */
export function pathOnCircle(radius: number, count: number, centre: Point = PATH_CENTRE): Path {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return {
      x: round(centre.x + radius * Math.cos(angle)),
      y: round(centre.y + radius * Math.sin(angle)),
    };
  });
}

/**
 * The same path sampled the way a pointer samples it: `step - 1` points between each pair
 * of turns, each one displaced a little to one side of the straight line it was invented
 * on, by `amplitude` pixels.
 *
 * A path typed in as a list of turns is a drawing teacher's diagram, not a drag: it has
 * nothing in it to thin, and a simplifier tested against it can only ever be shown
 * keeping everything. The displacement is a sine of the position along the path - smooth,
 * like a hand that wobbles, rather than noise, which would make "how many points came
 * back?" a question about a seed - and it is the same every run, for the same reason.
 */
export function densify(path: Path, step: number, amplitude = 2): Path {
  if (path.length === 0 || step < 2) return [...path];
  const out: Point[] = [{ ...path[0] }];
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    // The unit normal of this stretch: the direction a wobble leans sideways along.
    const nx = -dy / length;
    const ny = dx / length;
    for (let inside = 1; inside < step; inside += 1) {
      const t = inside / step;
      const wobble = Math.sin((index + t) * 1.7) * amplitude;
      out.push({
        x: round(from.x + dx * t + nx * wobble),
        y: round(from.y + dy * t + ny * wobble),
      });
    }
    out.push({ ...to });
  }
  return out;
}

/** The same path, half the size about its own top-left - for a resize test's "before". */
export function scaled(path: Path, factor: number): Path {
  const origin = path[0];
  return path.map((point) => ({ x: round(origin.x + (point.x - origin.x) * factor), y: round(origin.y + (point.y - origin.y) * factor) }));
}

/** The same path, moved. Used by a test that wants a stroke somewhere else. */
export function moved(path: Path, dx: number, dy: number): Path {
  return path.map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) }));
}

/** The extremes of a path, which is what a stroke's box is made of. */
export function pathBounds(path: Path): { x: number; y: number; width: number; height: number } {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Two decimals, so a fixture's numbers print the same wherever they are compared. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
