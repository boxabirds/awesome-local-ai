// Story 11 `stroke.model` unit cases (TC-01 to TC-08, plus the boundaries the design
// names): the three pure geometry functions and the stroke schema, against a real Y.Doc.
//
// The geometry is asserted as a *bound*, not as a shape: a simplification is correct
// when no recorded point is farther from it than the tolerance, whatever points it kept.
// That is the promise the PRD makes ("the finished stroke is smoother than what was
// drawn, never a different shape") and the only kind of assertion that cannot drift with
// the fixture.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify.ts';
import {
  createStroke,
  scaledPoints,
  strokeHitTest,
  strokeSnapshot,
  strokesOf,
  asStrokeSnapshot,
  type StrokeSnap,
} from '../../src/shared/objects/stroke.ts';
import { initDoc, objectSnapshots, createSticky, resizeObjects, LOCAL_ORIGIN } from '../../src/shared/board-model.ts';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';
import type { Point } from '../../src/shared/geometry.ts';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.ts';
import {
  HANDWRITTEN_LOOP,
  LONG_SPIRAL,
  ONE_POINT,
  THREE_POINTS,
  TWO_POINTS,
  UNDERLINE,
  copyPath,
  straightRun,
} from '../../tests/fixtures/pen-paths.ts';

/** How many `doc` updates (transactions) `fn` wrote. */
function updatesOf(doc: Y.Doc, fn: () => unknown): number {
  let updates = 0;
  const h = () => updates++;
  doc.on('update', h);
  fn();
  doc.off('update', h);
  return updates;
}

/** The transaction origins of the updates `fn` wrote. */
function originsOf(doc: Y.Doc, fn: () => unknown): unknown[] {
  const origins: unknown[] = [];
  const h = (_update: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', h);
  fn();
  doc.off('update', h);
  return origins;
}
function stroke(
  doc: Y.Doc,
  points: readonly Point[],
  color: 'black' | 'blue' | 'red' | 'green' | 'orange' | 'purple' = 'blue',
  thickness: 'thin' | 'medium' | 'thick' = 'medium',
): string {
  const id = createStroke(doc, { points, color, thickness }, 'me');
  if (id === null) throw new Error('createStroke rejected a valid stroke');
  return id;
}

describe('stroke.model — simplify', () => {
  it('TC-01 simplifies a hand-drawn loop at tolerance 1, every recorded point within 1 of the result', () => {
    const raw = copyPath(HANDWRITTEN_LOOP);
    const out = simplify(raw, 1);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(raw.length);
    // The bound the whole smoothing promise rests on.
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('TC-02 simplifies the same path at tolerance 0.5 within half a unit', () => {
    const raw = copyPath(HANDWRITTEN_LOOP);
    const out = simplify(raw, 0.5);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(out.length).toBeLessThan(raw.length);
    // A finer tolerance keeps at least as much of the line as a coarser one.
    expect(out.length).toBeGreaterThan(simplify(raw, 1).length);
  });

  it('TC-01b keeps the first and last point, so a stroke starts and ends where it was drawn', () => {
    const raw = copyPath(UNDERLINE);
    const out = simplify(raw, 1);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('simplifies a two point path to itself and an empty one to nothing', () => {
    expect(simplify(TWO_POINTS, 1)).toEqual(TWO_POINTS.map((p) => ({ x: p.x, y: p.y })));
    expect(simplify([], 1)).toEqual([]);
    expect(simplify(ONE_POINT, 1)).toEqual([{ x: ONE_POINT[0].x, y: ONE_POINT[0].y }]);
  });

  it('drops the point a straight run passes through', () => {
    const straight = straightRun(40, 0, 0, 5);
    expect(simplify(straight, 1)).toEqual([straight[0], straight[straight.length - 1]]);
  });
});

describe('stroke.model — splitPoints', () => {
  it('TC-03 splits at the maximum: one part below it, two above, sharing the join', () => {
    const below = straightRun(STROKE_MAX_POINTS - 1);
    const exact = straightRun(STROKE_MAX_POINTS);
    const above = straightRun(STROKE_MAX_POINTS + 1);
    const a = splitPoints(below, STROKE_MAX_POINTS);
    const b = splitPoints(exact, STROKE_MAX_POINTS);
    const c = splitPoints(above, STROKE_MAX_POINTS);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(2);
    // The join: part two begins at the point part one ended at, so the two strokes
    // the Pen tool commits are one unbroken line.
    const first = c[0];
    expect(c[1][0]).toEqual(first[first.length - 1]);
    expect(first).toHaveLength(STROKE_MAX_POINTS);
  });

  it('TC-03b splits a long path into parts of at most the maximum, joined end to end', () => {
    const parts = splitPoints(LONG_SPIRAL, STROKE_MAX_POINTS);
    expect(parts.length).toBe(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(STROKE_MAX_POINTS + 1);
    for (let i = 1; i < parts.length; i++) {
      const prev = parts[i - 1];
      expect(parts[i][0]).toEqual(prev[prev.length - 1]);
    }
  });

  it('splits nothing that fits, and an empty path into no parts', () => {
    expect(splitPoints([], 10)).toEqual([]);
    expect(splitPoints(TWO_POINTS, 10)).toHaveLength(1);
    expect(splitPoints(TWO_POINTS, 10)[0]).toEqual(TWO_POINTS.map((p) => ({ x: p.x, y: p.y })));
  });
});

describe('stroke.model — smoothPath', () => {
  it('TC-08 draws a path of quadratic segments through the points, the same every time', () => {
    const d1 = smoothPath(copyPath(THREE_POINTS));
    const d2 = smoothPath(copyPath(THREE_POINTS));
    expect(d1).toBe(d2);
    expect(d1.startsWith('M')).toBe(true);
    expect(d1).toContain('Q');
    // It ends on the last point, so the stroke stops where the pen left the board.
    const numbers = d1.slice(1).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(numbers.slice(-2)).toEqual([THREE_POINTS[2].x, THREE_POINTS[2].y]);
  });

  it('draws a two point path as a straight segment and one point as a dot', () => {
    const two = smoothPath(TWO_POINTS);
    expect(two).toContain('M');
    expect(two).not.toContain('Q');
    expect(two).toContain('L');
    // A zero-length subpath: a round line cap paints it as a dot (pen.dot).
    const one = smoothPath(ONE_POINT);
    expect(one.match(/M\s*\d+/g)).toHaveLength(1);
    expect(one).toContain('L');
  });

  it('draws nothing for no points', () => {
    expect(smoothPath([])).toBe('');
  });

  it('is deterministic: the same points draw the same path', () => {
    expect(smoothPath(copyPath(HANDWRITTEN_LOOP))).toBe(smoothPath(copyPath(HANDWRITTEN_LOOP)));
  });
});

describe('stroke.model — createStroke', () => {
  it('TC-04 stores a stroke as board points relative to its box, padded by the thickness', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const points = [
      { x: 100, y: 100 },
      { x: 140, y: 120 },
      { x: 180, y: 100 },
    ];
    let id!: string;
    const updates = updatesOf(doc, () => {
      id = stroke(doc, points, 'green', 'thick');
    });
    expect(updates).toBe(1);
    const snap = strokeSnapshot(doc, id)!;
    expect(snap.type).toBe('stroke');
    // Half of `thick` is 4 board units of padding on every side.
    expect(snap.x).toBe(96);
    expect(snap.y).toBe(96);
    expect(snap.width).toBe(88);
    expect(snap.height).toBe(28);
    expect(snap.baseWidth).toBe(88);
    expect(snap.baseHeight).toBe(28);
    expect(snap.color).toBe('green');
    expect(snap.thickness).toBe('thick');
    expect(snap.createdBy).toBe('me');
    // Flattened, relative to the box origin, so (100, 100) is 4 across and 4 down.
    expect(snap.points).toEqual([4, 4, 44, 24, 84, 4]);
    expect(scaledPoints(snap)).toEqual(points.map((p) => ({ x: p.x, y: p.y })));
  });

  it('TC-04b writes one LOCAL_ORIGIN transaction and stacks the stroke above the board', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const id = stroke(doc, TWO_POINTS)!;
    expect(originsOf(doc, () => stroke(doc, UNDERLINE))).toEqual([LOCAL_ORIGIN]);
    const snaps = strokesOf(objectSnapshots(doc));
    expect(snaps.map((s) => s.id)).toContain(id);
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    expect(strokeSnapshot(doc, id)!.z).toBeGreaterThan(sticky.z);
  });

  it('TC-04c draws a single point as a dot: a thickness square holding one relative point', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, ONE_POINT, 'red', 'thick')!;
    const snap = strokeSnapshot(doc, id)!;
    expect(snap.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(snap.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(snap.points).toHaveLength(2);
    expect(snap.points).toEqual([4, 4]);
    expect(scaledPoints(snap)).toEqual(ONE_POINT.map((p) => ({ x: p.x, y: p.y })));
    expect(smoothPath(scaledPoints(snap))).toContain('L');
  });

  it('TC-05 refuses an empty stroke, a coordinate that is not a number and an unknown option', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const bad: unknown[] = [
      { points: [], color: 'black', thickness: 'thin' },
      { points: [{ x: NaN, y: 1 }], color: 'black', thickness: 'thin' },
      { points: [{ x: 1, y: Infinity }], color: 'black', thickness: 'thin' },
      { points: [{ x: 1, y: 1 }], color: 'pink', thickness: 'thin' },
      { points: [{ x: 1, y: 1 }], color: undefined, thickness: 'thin' },
      { points: [{ x: 1, y: 1 }], color: 'black', thickness: 'huge' },
      { points: [{ x: 1, y: 1 }], color: 'black', thickness: undefined },
      { points: 'nonsense', color: 'black', thickness: 'thin' },
    ];
    for (const args of bad) {
      expect(
        updatesOf(doc, () => {
          expect(createStroke(doc, args as never, 'me')).toBe(null);
        }),
      ).toBe(0);
    }
    expect(objectSnapshots(doc)).toHaveLength(0);
  });

  it('TC-05b leaves an undo stack with one step per stroke and never a partial stroke', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const um = new Y.UndoManager(objectsOf(doc), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });
    stroke(doc, TWO_POINTS);
    expect(updatesOf(doc, () => expect(createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'me')).toBe(null))).toBe(0);
    // What the Pen tool does between two strokes: one undo step each. Yjs merges
    // same-origin writes inside one capture window, so the boundary is the product's
    // job, not something a caller can assume of `createStroke` (see story 10's NOTES).
    um.stopCapturing();
    stroke(doc, THREE_POINTS);
    um.undo();
    expect(strokesOf(objectSnapshots(doc))).toHaveLength(1);
    um.undo();
    expect(strokesOf(objectSnapshots(doc))).toHaveLength(0);
    um.redo();
    expect(strokesOf(objectSnapshots(doc))).toHaveLength(1);
  });
});

describe('stroke.model — scaledPoints and hit test', () => {
  it('TC-06 scales the stored points by the box without rewriting them', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, UNDERLINE, 'blue', 'medium')!;
    const before = strokeSnapshot(doc, id)!;
    const raw = scaledPoints(before);
    resizeObjects(doc, new Map([[id, { x: before.x, y: before.y, width: before.width * 2, height: before.height * 2 }]]));
    const after = strokeSnapshot(doc, id)!;
    const scaled = scaledPoints(after);
    expect(scaled).toHaveLength(raw.length);
    // The corner the box was resized from stays; every point moves away from it at
    // twice its distance, which is the proportion the sketch keeps (pen.resize). The
    // measurement is therefore taken from the box origin, which did not move.
    for (let i = 0; i < raw.length; i++) {
      expect(scaled[i].x - after.x).toBeCloseTo((raw[i].x - before.x) * 2, 6);
      expect(scaled[i].y - after.y).toBeCloseTo((raw[i].y - before.y) * 2, 6);
    }
    // The thickness is the thickness it was drawn with, at any scale.
    expect(after.thickness).toBe('medium');
  });

  it('TC-06b follows a move, and survives a box that has no usable size', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, TWO_POINTS, 'black', 'thin')!;
    const before = scaledPoints(strokeSnapshot(doc, id)!);
    resizeObjects(doc, new Map([[id, { x: 90, y: 40, width: 400, height: 100 }]]));
    const moved = scaledPoints(strokeSnapshot(doc, id)!);
    expect(moved[0].x).toBeGreaterThan(90);
    expect(moved[0].y).toBeGreaterThan(40);
    // The line is still a horizontal run, stretched with the box.
    expect(moved[1].y).toBeCloseTo(moved[0].y, 6);
    expect(moved[1].x - moved[0].x).toBeGreaterThan(before[1].x - before[0].x);
    const broken = { ...strokeSnapshot(doc, id)!, width: 0, height: 0, baseWidth: 0, baseHeight: 0 };
    expect(() => scaledPoints(broken)).not.toThrow();
    expect(scaledPoints(broken).length).toBe(2);
  });

  it('TC-07 selects a point on the line, and one past half the thickness off it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A 400-unit horizontal line drawn `thin`: half its thickness is 1 board unit.
    const id = stroke(doc, [{ x: 0, y: 0 }, { x: 400, y: 0 }], 'black', 'thin')!;
    const obj = strokeSnapshot(doc, id)!;
    // The line itself: 0 from it.
    expect(strokeHitTest(obj, { x: 200, y: 0 })).toBe(true);
    // 5.9 board units away at zoom 1 is inside the 6 px tolerance.
    expect(strokeHitTest(obj, { x: 200, y: 5.9 })).toBe(true);
    // 6.1 board units is not, though it is still a board point on the stroke's run.
    expect(strokeHitTest(obj, { x: 200, y: 6.1 })).toBe(false);
  });

  it('TC-07b converts the click tolerance by the zoom, not by the thickness alone', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, [{ x: 0, y: 0 }, { x: 400, y: 0 }], 'black', 'thin')!;
    const obj = strokeSnapshot(doc, id)!;
    // At 50% zoom 6 screen px are 12 board units; at 200% they are 3.
    expect(strokeHitTest(obj, { x: 200, y: 11.9 }, 0.5)).toBe(true);
    expect(strokeHitTest(obj, { x: 200, y: 12.1 }, 0.5)).toBe(false);
    expect(strokeHitTest(obj, { x: 200, y: 2.9 }, 2)).toBe(true);
    expect(strokeHitTest(obj, { x: 200, y: 3.1 }, 2)).toBe(false);
    // A `thick` stroke is 4 units half-wide, but the click tolerance is the wider of
    // the two at this zoom, so a click 6.5 out still misses its line.
    const fat = strokeSnapshot(doc, stroke(doc, [{ x: 0, y: 0 }, { x: 400, y: 0 }], 'black', 'thick'))!;
    expect(strokeHitTest(fat, { x: 200, y: 4.5 })).toBe(true);
    expect(strokeHitTest(fat, { x: 200, y: 6.5 })).toBe(false);
  });

  it('TC-07c hits the whole line of a resized stroke, scaled with the box', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, [{ x: 0, y: 0 }, { x: 400, y: 0 }], 'black', 'thin')!;
    setBox(doc, id, { x: 0, y: 0, width: 800, height: 2 });
    const obj = strokeSnapshot(doc, id)!;
    // The box is twice as wide as it was drawn and the same height, so the line it
    // holds runs along y = 1 and reaches well past the old 400-unit end.
    expect(strokeHitTest(obj, { x: 600, y: 1 })).toBe(true);
    expect(strokeHitTest(obj, { x: 600, y: 7.1 })).toBe(false);
    expect(strokeHitTest(obj, { x: 600, y: 6.9 })).toBe(true);
  });

  it('TC-07d never hits a stroke that holds no usable points', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, TWO_POINTS)!;
    const objects = objectsOf(doc);
    const obj = objects.get(id)!;
    obj.set('points', ['a', 'b']);
    const snap = asStrokeSnapshot(objectSnapshots(doc).find((o) => o.id === id)!);
    expect(snap.points).toEqual([]);
    expect(strokeHitTest(snap, { x: 100, y: 100 })).toBe(false);
    expect(strokeHitTest(snap, { x: 100, y: 100 }, 2)).toBe(false);
    expect(smoothPath(scaledPoints(snap))).toBe('');
  });

  it('TC-07e leaves a click inside the box but off the line to whatever is underneath', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A big loop: its box is enormous, its line is nowhere near the middle.
    const id = stroke(doc, HANDWRITTEN_LOOP, 'purple', 'medium')!;
    const obj = strokeSnapshot(doc, id)!;
    const centre = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
    expect(strokeHitTest(obj, centre)).toBe(false);
  });
});

describe('stroke.model — the objects map', () => {
  it('TC-06c a stroke is one object with its own fields, ordered with the rest', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const id = stroke(doc, THREE_POINTS, 'orange', 'thin')!;
    const all = objectSnapshots(doc);
    const snap = all.find((o) => o.id === id)!;
    expect(snap.type).toBe('stroke');
    expect(snap.color).toBe('orange');
    expect(snap.thickness).toBe('thin');
    expect(snap.points).toBeInstanceOf(Array);
    expect(snap.points).toHaveLength(6);
    expect(snap.baseWidth).toBeGreaterThan(0);
    expect(snap.baseHeight).toBeGreaterThan(0);
    expect(all.findIndex((o) => o.id === id)).toBeGreaterThan(all.findIndex((o) => o.type === 'sticky'));
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toHaveLength(3);
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(STROKE_MIN_SIZE_WORLD).toBe(4);
  });

  it('a stroke reads back its defaults when the stored names are nonsense', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, TWO_POINTS, 'blue', 'thin')!;
    const obj = objectsOf(doc).get(id)!;
    obj.set('color', 'mauve');
    obj.set('thickness', 'enormous');
    // The generic snapshot does not guess: an unknown name reads as no name at all.
    const raw = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(raw.color).toBeUndefined();
    expect(raw.thickness).toBeUndefined();
    // And the stroke renderer falls back to the pen's own defaults.
    const snap = strokeSnapshot(doc, id)!;
    expect(snap.color).toBe(DEFAULT_PEN_COLOR);
    expect(snap.thickness).toBe(DEFAULT_PEN_THICKNESS);
    const as = asStrokeSnapshot(snap);
    expect(as.color).toBe(DEFAULT_PEN_COLOR);
    expect(as.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(as.type).toBe('stroke');
  });

  it('scaledPoints of a stroke snapped from a snapshot list matches the document read', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = stroke(doc, UNDERLINE, 'red', 'medium')!;
    const fromList = asStrokeSnapshot(objectSnapshots(doc).find((o) => o.id === id)!);
    const fromDoc = strokeSnapshot(doc, id)!;
    expect(scaledPoints(fromList)).toEqual(scaledPoints(fromDoc as StrokeSnap));
  });
});

/** Give an object a new box, the way story 7's resize does. */
function setBox(doc: Y.Doc, id: string, box: { x: number; y: number; width: number; height: number }): void {
  expect(resizeObjects(doc, new Map([[id, box]]))).toBe(1);
}

/** The raw `objects` map of a document. */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}
