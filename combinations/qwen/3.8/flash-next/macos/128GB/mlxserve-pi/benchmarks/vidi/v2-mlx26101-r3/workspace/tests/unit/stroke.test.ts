import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  simplify,
  smoothPath,
  splitPoints,
} from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  createStroke,
  asStrokeSnapshot,
  scaledPoints,
  strokeHitTolerance,
  type StrokeDrawing,
} from '../../src/shared/objects/stroke';
import {
  OBJECTS_MAP,
  STROKE_TYPE,
  resizeObjects,
  snapshot,
  type StrokeSnapshot,
} from '../../src/shared/board-model';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
} from '../../src/shared/config';
import {
  CORNER,
  FLAT_LINE,
  HANDWRITTEN_LOOP,
  LONG_SPIRAL,
  UNDERLINE,
} from '../fixtures/pen-paths';

/**
 * Story 11, tasks 11.1 / 11.2 (TC-01 … TC-08): the parts of the pen that are pure functions over a
 * captured path, plus the two document operations the pen runs.
 *
 * Nothing here touches the DOM: the path arrives as the array a capture would have produced, and the
 * document is a `Y.Doc` with nothing behind it.
 */

/** A stroke drawing with sensible defaults, one field at a time away from valid. */
function drawing(overrides: Partial<StrokeDrawing> = {}): StrokeDrawing {
  return {
    points: [
      { x: 10, y: 10 },
      { x: 30, y: 18 },
      { x: 50, y: 12 },
    ],
    color: 'blue',
    thickness: 'medium',
    ...overrides,
  };
}

/** The one stroke on the board, read back through the stroke's own reader. */
function onlyStroke(doc: Y.Doc): StrokeSnapshot {
  const objects = snapshot(doc);
  if (objects.length !== 1) {
    throw new Error(`expected one object on the board, found ${objects.length}`);
  }
  const stroke = asStrokeSnapshot(objects[0]);
  if (stroke === null) {
    throw new Error(`the object on the board is a ${objects[0].type}, not a readable stroke`);
  }
  return stroke;
}

/**
 * Stretch a stroke's box about its own top-left, which is what a resize handle held with the
 * pointer anchored on the opposite corner does.
 */
function stretch(doc: Y.Doc, stroke: StrokeSnapshot, scaleX: number, scaleY: number): void {
  resizeObjects(
    doc,
    new Map([
      [
        stroke.id,
        {
          x: stroke.x,
          y: stroke.y,
          width: stroke.width * scaleX,
          height: stroke.height * scaleY,
        },
      ],
    ]),
  );
}

describe('simplify (TC-01, TC-02)', () => {
  it('keeps every raw point within the tolerance of the result, and uses fewer points', () => {
    const result = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);

    expect(result.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    // The guarantee Ramer–Douglas–Peucker makes: the result never strays further from the raw path
    // than the tolerance it was given.
    for (const raw of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(result, raw)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });

  it('keeps more of the same path at a tighter tolerance, still inside it', () => {
    const loose = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX);
    const tight = simplify(HANDWRITTEN_LOOP, STROKE_SIMPLIFY_TOLERANCE_PX / 2);

    expect(tight.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    expect(tight.length).toBeGreaterThan(loose.length);
    for (const raw of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(tight, raw)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX / 2);
    }
  });

  it('takes the 128-point underline down to fewer than half its points', () => {
    const result = simplify(UNDERLINE, STROKE_SIMPLIFY_TOLERANCE_PX);

    // A mostly-straight path is the case simplification exists for. It does not come down to three
    // points, because this underline sags and wobbles by more than the tolerance in places - which is
    // the point of the guarantee below: what is thrown away is what a pixel could not have shown.
    expect(result.length).toBeLessThan(UNDERLINE.length / 2);
    for (const raw of UNDERLINE) {
      expect(distanceToPolyline(result, raw)).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX);
    }
  });

  it('leaves a path alone when there is no tolerance to simplify with', () => {
    expect(simplify(HANDWRITTEN_LOOP, 0)).toEqual([...HANDWRITTEN_LOOP]);
    expect(simplify(FLAT_LINE, -1)).toEqual([...FLAT_LINE]);
  });

  it('survives paths too short to have anything to drop', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([CORNER[0]], 1)).toEqual([CORNER[0]]);
    expect(simplify(FLAT_LINE, 1)).toEqual([FLAT_LINE[0], FLAT_LINE[FLAT_LINE.length - 1]]);
  });

  it('does not modify the array it was given', () => {
    const points = UNDERLINE.map((point) => ({ ...point }));
    const before = JSON.stringify(points);

    simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX);

    expect(JSON.stringify(points)).toBe(before);
  });
});

describe('splitPoints (TC-03)', () => {
  it('splits a path that is one point too long, and joins the parts at a shared point', () => {
    const parts = splitPoints(LONG_SPIRAL, STROKE_MAX_POINTS);

    expect(parts.map((part) => part.length)).toEqual([
      STROKE_MAX_POINTS,
      LONG_SPIRAL.length - STROKE_MAX_POINTS + 1,
    ]);
    // The join: the second part starts where the first one ended, so the drawing is not cut open.
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    // Nothing is lost between them but the duplicated joint.
    const rejoined = [...parts[0], ...parts[1].slice(1)];
    expect(rejoined).toEqual([...LONG_SPIRAL]);
  });

  it('leaves a path alone at the limit, and at one point under it', () => {
    const at = LONG_SPIRAL.slice(0, STROKE_MAX_POINTS);
    const under = LONG_SPIRAL.slice(0, STROKE_MAX_POINTS - 1);

    expect(splitPoints(at, STROKE_MAX_POINTS).map((part) => part.length)).toEqual([
      STROKE_MAX_POINTS,
    ]);
    expect(splitPoints(under, STROKE_MAX_POINTS).map((part) => part.length)).toEqual([
      STROKE_MAX_POINTS - 1,
    ]);
  });

  it('splits a very long path into parts that all fit, joined end to end', () => {
    const points = LONG_SPIRAL.concat(LONG_SPIRAL, LONG_SPIRAL);
    const parts = splitPoints(points, 1000);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1000);
      expect(part.length).toBeGreaterThan(1);
    }
    for (let part = 1; part < parts.length; part += 1) {
      expect(parts[part][0]).toEqual(parts[part - 1][parts[part - 1].length - 1]);
    }
  });

  it('has nothing to say about an empty path', () => {
    expect(splitPoints([], 10)).toEqual([]);
  });
});

describe('smoothPath (TC-08)', () => {
  it('draws a path that starts with a move and uses quadratics through the points', () => {
    const path = smoothPath(CORNER);

    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('Q');
    // Ends on the last point, so the drawing does not stop short of where the pen was lifted.
    expect(path.endsWith(`${CORNER[2].x} ${CORNER[2].y}`)).toBe(true);
  });

  it('gives the same answer twice, so a re-render cannot redraw the stroke', () => {
    const points = HANDWRITTEN_LOOP.slice(0, 40);

    expect(smoothPath(points)).toBe(smoothPath(points));
  });

  it('draws a straight line for two points and a dot for one', () => {
    expect(smoothPath(FLAT_LINE.slice(0, 2))).toBe('M 0 0 L 50 0');
    expect(smoothPath([CORNER[0]])).toBe('M 10 10 L 10 10');
    expect(smoothPath([])).toBe('');
  });

  it('never draws a NaN, whatever it is handed', () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 4 },
      { x: 8, y: Number.NaN },
      { x: 12, y: 12 },
    ]);

    expect(path).not.toContain('NaN');
    expect(path).toBe('M 0 0 L 12 12');
  });
});

describe('createStroke (TC-04, TC-05)', () => {
  it('stores the path in its own box, padded by half the thickness', () => {
    const doc = new Y.Doc();
    const points = [
      { x: 100, y: 100 },
      { x: 140, y: 120 },
      { x: 180, y: 100 },
    ];

    const id = createStroke(doc, drawing({ points, thickness: 'medium' }), 'someone');

    expect(id).not.toBeNull();
    const stroke = onlyStroke(doc);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    expect(stroke.x).toBe(100 - half);
    expect(stroke.y).toBe(100 - half);
    expect(stroke.width).toBe(80 + half * 2);
    expect(stroke.height).toBe(20 + half * 2);
    // Stored relative to the box: the first point sits half a thickness inside it.
    expect(stroke.points.slice(0, 2)).toEqual([half, half]);
    // The box the stroke was made at, which is what a resize scales against.
    expect(stroke.baseWidth).toBe(stroke.width);
    expect(stroke.baseHeight).toBe(stroke.height);
    expect(stroke.color).toBe('blue');
    // The document keeps a stroke's colour in the field every object keeps its colour in, and the
    // generic snapshot reports it as `penColor`, because its own `color` is typed as a sticky's.
    expect(snapshot(doc)[0].penColor).toBe('blue');
    expect(doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id)?.get('color')).toBe('blue');
    expect(stroke.thickness).toBe('medium');
    expect(stroke.createdBy).toBe('someone');
    expect(stroke.z).toBeGreaterThan(0);
  });

  it('commits every point of a drawing in one transaction', () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('update', () => {
      transactions += 1;
    });

    createStroke(doc, drawing({ points: UNDERLINE.slice(0, 40) }), 'someone');

    expect(transactions).toBe(1);
  });

  it('leaves a board with nothing on it when given no path', () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('update', () => {
      transactions += 1;
    });

    expect(createStroke(doc, drawing({ points: [] }), 'someone')).toBeNull();

    expect(snapshot(doc)).toEqual([]);
    expect(transactions).toBe(0);
  });

  it('refuses a path with a coordinate that is not a number, and writes nothing', () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('update', () => {
      transactions += 1;
    });

    const bad = [
      { x: 10, y: 10 },
      { x: Number.NaN, y: 20 },
    ];

    expect(createStroke(doc, drawing({ points: bad }), 'someone')).toBeNull();
    expect(snapshot(doc)).toEqual([]);
    expect(transactions).toBe(0);
  });

  it.each([
    ['a colour the pen does not have', { color: 'pink' as never }],
    ['a thickness the pen does not have', { thickness: 'huge' as never }],
    ['no colour at all', { color: undefined as never }],
    ['no thickness at all', { thickness: undefined as never }],
  ])('refuses %s and writes nothing', (_label, overrides) => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('update', () => {
      transactions += 1;
    });

    expect(createStroke(doc, drawing(overrides), 'someone')).toBeNull();

    expect(snapshot(doc)).toEqual([]);
    expect(transactions).toBe(0);
  });

  it('stores a dot as one point in a box the size of the thickness', () => {
    const doc = new Y.Doc();

    createStroke(doc, drawing({ points: [{ x: 200, y: 300 }], thickness: 'thick' }), 'someone');

    const stroke = onlyStroke(doc);
    const size = PEN_THICKNESS_WORLD.thick;
    expect(stroke.points).toHaveLength(2);
    expect(stroke.width).toBe(size);
    expect(stroke.height).toBe(size);
    expect(stroke.x).toBe(200 - size / 2);
    expect(stroke.y).toBe(300 - size / 2);
    // And it still hits: the point it holds is its own centre.
    const points = scaledPoints(stroke);
    expect(points).toHaveLength(1);
    expect(distanceToPolyline(points, { x: 200, y: 300 })).toBe(0);
  });

  it('puts a second stroke above the first', () => {
    const doc = new Y.Doc();

    createStroke(doc, drawing(), 'someone');
    createStroke(doc, drawing({ points: FLAT_LINE }), 'someone');

    const [first, second] = snapshot(doc);
    expect(second.z).toBeGreaterThan(first.z);
  });

  it('refuses to say who made the stroke when nobody is named', () => {
    const doc = new Y.Doc();

    expect(createStroke(doc, drawing(), '')).toBeNull();
    expect(snapshot(doc)).toEqual([]);
  });
});

describe('scaledPoints (TC-06, TC-07)', () => {
  /** A horizontal stroke of four points, drawn from 100,100 to 500,100. */
  function line(doc: Y.Doc): StrokeSnapshot {
    const id = createStroke(
      doc,
      drawing({
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 400, y: 100 },
          { x: 500, y: 100 },
        ],
      }),
      'someone',
    );
    if (id === null) {
      throw new Error('the line was not committed');
    }
    return onlyStroke(doc);
  }

  it('gives the world point of every stored point, unscaled at the size it was made', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);

    expect(scaledPoints(stroke)).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 400, y: 100 },
      { x: 500, y: 100 },
    ]);
  });

  it('scales every point when the box is doubled, and leaves the thickness alone', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);

    stretch(doc, stroke, 2, 2);

    const resized = onlyStroke(doc);
    const points = scaledPoints(resized);
    // The box grew by its own padding on both sides, so the doubled path is the stored offset from
    // the box origin, doubled: the first point was 2 units inside a box that starts at 98.
    expect(points.map((point) => point.x)).toEqual([102, 302, 702, 902]);
    expect(points.map((point) => point.y)).toEqual([102, 102, 102, 102]);
    // Which is the same rule stated without arithmetic: a point keeps its place within the box, and
    // every gap between two points doubles.
    const before = scaledPoints(stroke);
    for (let index = 0; index < before.length; index += 1) {
      expect(points[index].x - resized.x).toBeCloseTo((before[index].x - stroke.x) * 2, 6);
      expect(points[index].y - resized.y).toBeCloseTo((before[index].y - stroke.y) * 2, 6);
    }
    // A stroke is a line, not a shape: stretching it does not make it thicker.
    expect(resized.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD[resized.thickness]).toBe(PEN_THICKNESS_WORLD.medium);
    // The reference box it was made at has not moved, so a second resize scales from the same place.
    expect(resized.baseWidth).toBe(stroke.width);
    expect(resized.baseHeight).toBe(stroke.height);
  });

  it('scales a point by each axis on its own', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);

    stretch(doc, stroke, 2, 1);

    const points = scaledPoints(onlyStroke(doc));
    expect(points.map((point) => point.x)).toEqual([102, 302, 702, 902]);
    expect(points.map((point) => point.y)).toEqual([100, 100, 100, 100]);
  });

  it('falls back to the stored box when there is no original size to scale from', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);
    const raw = doc.getMap<Y.Map<unknown>>('objects').get(stroke.id);
    raw.delete('baseWidth');
    raw.delete('baseHeight');

    // Without a reference box the stroke is drawn where it was stored, not at zero and not at NaN.
    expect(scaledPoints(onlyStroke(doc))).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 400, y: 100 },
      { x: 500, y: 100 },
    ]);
  });

  it('hits 5.9 units from the line and misses 6.1 at the default zoom', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);
    const points = scaledPoints(stroke);
    const on = { x: 300, y: 100 };

    // The rule the hit path is built to: half the thickness, or six screen units, whichever is more.
    expect(strokeHitTolerance(stroke, 1)).toBe(
      Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1),
    );
    expect(strokeHitTolerance(stroke, 1)).toBe(STROKE_HIT_TOLERANCE_PX);

    expect(distanceToPolyline(points, on)).toBe(0);
    expect(distanceToPolyline(points, { x: 300, y: 100 + 5.9 })).toBeLessThanOrEqual(
      strokeHitTolerance(stroke, 1),
    );
    expect(distanceToPolyline(points, { x: 300, y: 100 + 6.1 })).toBeGreaterThan(
      strokeHitTolerance(stroke, 1),
    );
  });

  it('keeps the hit distance in screen units when the board is zoomed', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);

    // Zoomed out, the six screen units are more world units; zoomed in, fewer - until the thickness
    // itself is the wider of the two, which is why the rule is a max and not a division.
    expect(strokeHitTolerance(stroke, 0.5)).toBe(STROKE_HIT_TOLERANCE_PX / 0.5);
    expect(strokeHitTolerance(stroke, 4)).toBe(PEN_THICKNESS_WORLD.medium / 2);
    expect(strokeHitTolerance(stroke, 10)).toBe(PEN_THICKNESS_WORLD.medium / 2);
  });

  it('draws a thick stroke with the thickness it was given, not a scaled one', () => {
    const doc = new Y.Doc();
    const stroke = line(doc);

    stretch(doc, stroke, 4, 4);

    const resized = onlyStroke(doc);
    expect(PEN_THICKNESS_WORLD[resized.thickness]).toBe(4);
    // The minimum a resize can take it to is still four world units, whatever it is scaled to.
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
  });
});

describe('a stroke the board cannot read', () => {
  it('is left off the board when its path is missing or broken', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, drawing({ points: UNDERLINE.slice(0, 6) }), 'someone');
    if (id === null) {
      throw new Error('the stroke was not committed');
    }
    const raw = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
    if (raw === undefined) {
      throw new Error('the stroke was not committed');
    }

    raw.set('points', 'not a path');
    expect(snapshot(doc)).toEqual([]);

    raw.set('points', [1, 2, 3]); // an odd count: a point with no partner
    expect(snapshot(doc)).toEqual([]);

    raw.set('points', [10, 10, Number.NaN, 20]);
    expect(snapshot(doc)).toEqual([]);

    raw.delete('points');
    expect(snapshot(doc)).toEqual([]);
  });

  it('falls back to the defaults when the colour or the thickness is not one the pen has', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, drawing({ points: UNDERLINE.slice(0, 6) }), 'someone');
    const raw = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
    if (raw === undefined) {
      throw new Error('the stroke was not committed');
    }

    raw.set('color', 'chartreuse');
    raw.set('thickness', 12);

    // The board's reader leaves an unknown value out, the way it does for a shape's kind; the stroke's
    // own reader is what gives it the default, so the drawing code never has to ask.
    const read = snapshot(doc)[0];
    if (read === undefined) {
      throw new Error('a stroke in an unknown colour is still on the board');
    }
    const stroke = asStrokeSnapshot(read);
    if (stroke === null) {
      throw new Error('a stroke in an unknown colour is still a stroke');
    }
    expect(stroke.color).toBe('black');
    expect(stroke.thickness).toBe('medium');
  });
});

describe('the pen’s settings', () => {
  it('are the ones the design names', () => {
    expect(STROKE_SIMPLIFY_TOLERANCE_PX).toBe(1);
    expect(STROKE_MAX_POINTS).toBe(5000);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
    expect(PEN_THICKNESS_WORLD).toEqual({ thin: 2, medium: 4, thick: 8 });
  });

  it('offers six colours and three thicknesses, and starts on black and medium', () => {
    expect(Object.keys(PEN_COLORS)).toEqual([
      'black',
      'blue',
      'red',
      'green',
      'orange',
      'purple',
    ]);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toEqual(['thin', 'medium', 'thick']);
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
    for (const hex of Object.values(PEN_COLORS)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
