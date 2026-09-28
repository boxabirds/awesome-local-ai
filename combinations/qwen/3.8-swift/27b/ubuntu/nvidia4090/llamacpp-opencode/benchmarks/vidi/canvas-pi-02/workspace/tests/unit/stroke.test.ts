// Unit tests for the stroke model and freehand geometry (story 11,
// stroke.model, TC-01 to TC-08): RDP simplification, long-stroke
// splitting, smooth path, createStroke validation, scaled points and the
// line-distance hit tolerance. Uses a real Y.Doc (no mocks); each mutation
// also counts `update` events: exactly 1 for a successful mutation, 0 for a
// rejection.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { initDoc, resizeObjects } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  strokeSnapshot,
  type PenColor,
  type PenThickness,
} from '../../src/shared/objects/stroke';
import { handwrittenLoopPath, longSpiralPath, underlinePath } from '../fixtures/pen-paths';

interface UpdateSpy {
  count: number;
  off: () => void;
}

/** Counts Yjs update events on the doc (one per transaction). */
function spyUpdates(doc: Y.Doc): UpdateSpy {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const PEN_THICKNESS_MEDIUM_HALF = PEN_THICKNESS_WORLD.medium / 2;

describe('story 11: stroke geometry (simplify / splitPoints / smoothPath)', () => {
  it('TC-01: simplify the handwritten loop at tolerance 1 → every raw point within 1 unit; fewer points', () => {
    const raw = handwrittenLoopPath;
    const out = simplify(raw, 1);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(raw.length); // it really simplified
    for (const p of raw) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1);
    }
    // First and last are kept (the line endpoints survive smoothing).
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('TC-02: the same loop at tolerance 0.5 (zoom 200%: 1 px / zoom = 0.5) → every raw point within 0.5', () => {
    const raw = underlinePath;
    const out = simplify(raw, 1 / 2);
    for (const p of raw) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5);
    }
  });

  it('TC-03: splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts with part 1\'s last point (boundary)', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i / 7) }));

    const one = splitPoints(make(STROKE_MAX_POINTS - 1));
    expect(one).toHaveLength(1);

    const exact = splitPoints(make(STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const two = splitPoints(make(STROKE_MAX_POINTS + 1));
    expect(two).toHaveLength(2);
    expect(two[0]).toHaveLength(STROKE_MAX_POINTS);
    // The parts join seamlessly: part 2 starts with part 1's last point.
    expect(two[1][0]).toEqual(two[0][two[0].length - 1]);
    expect(two[1]).toHaveLength(STROKE_MAX_POINTS + 1 - (STROKE_MAX_POINTS - 1));

    // The recorded 5,010-point spiral splits into 2 seamlessly-joined parts.
    const spiral = splitPoints(longSpiralPath);
    expect(spiral).toHaveLength(2);
    expect(spiral[1][0]).toEqual(spiral[0][spiral[0].length - 1]);

    // Default max is STROKE_MAX_POINTS.
    expect(splitPoints(make(STROKE_MAX_POINTS + 10)).length).toBe(2);
  });

  it('TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q');
    // Deterministic and exact for this input: M p0, Q p1 mid(p1,p2), Q p2 p2.
    expect(d).toBe('M 0 0 Q 10 5 15 2.5 Q 20 0 20 0');
    // A single point is a zero-length (round-cap dot) path.
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4');
    // Two points: M + L.
    expect(smoothPath(pts.slice(0, 2))).toBe('M 0 0 L 10 5');
    // Empty: nothing.
    expect(smoothPath([])).toBe('');
  });
});

describe('story 11: stroke model (createStroke / scaledPoints)', () => {
  it('TC-04: createStroke single point, thickness thick → bbox = thickness square; points length 2 (dot)', () => {
    const doc = newDoc();
    const spy = spyUpdates(doc);
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'black', thickness: 'thick' }, 'test');
    spy.off();
    expect(id).not.toBeNull();
    expect(spy.count).toBe(1); // one LOCAL_ORIGIN transaction

    const snap = strokeSnapshot(doc, id!);
    expect(snap).not.toBeNull();
    const t = PEN_THICKNESS_WORLD.thick; // 8
    expect(snap!.x).toBe(100 - t / 2);
    expect(snap!.y).toBe(200 - t / 2);
    expect(snap!.width).toBe(t);
    expect(snap!.height).toBe(t);
    expect(snap!.points).toHaveLength(2);
    // The stored point sits at the bbox centre (relative [4,4]).
    expect(snap!.points).toEqual([t / 2, t / 2]);
    expect(snap!.color).toBe('black');
    expect(snap!.thickness).toBe('thick');
    // World points round-trip to the clicked point.
    expect(scaledPoints(snap!)).toEqual([{ x: 100, y: 200 }]);
  });

  it('TC-05: empty points, NaN point, colour \'pink\', thickness \'huge\' → null, zero update events (negative, error paths)', () => {
    const doc = newDoc();
    const spy = spyUpdates(doc);

    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'test')).toBeNull();
    expect(
      createStroke(
        doc,
        {
          points: [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 1 },
          ],
          color: 'black',
          thickness: 'medium',
        },
        'test',
      ),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as PenColor, thickness: 'medium' }, 'test'),
    ).toBeNull();
    expect(
      createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as PenThickness }, 'test'),
    ).toBeNull();

    expect(spy.count).toBe(0); // no transaction was ever opened
    spy.off();
  });

  it('TC-06: scaledPoints after width and height doubled → coordinates doubled (relative to the bbox origin); thickness unchanged (proportional resize)', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      {
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 15 },
          { x: 30, y: 30 },
        ],
        color: 'red',
        thickness: 'thin',
      },
      'test',
    );
    expect(id).not.toBeNull();
    const before = strokeSnapshot(doc, id!);
    expect(before).not.toBeNull();
    const beforePts = scaledPoints(before!);
    expect(beforePts).toHaveLength(3);
    // Stored relative to the bbox origin (padded by thickness/2 = 1).
    expect(before!.x).toBe(9);
    expect(before!.y).toBe(9);
    expect(beforePts[0]).toEqual({ x: 10, y: 10 });

    // Double width and height in place (the story 7 aspect-locked resize).
    const ok = resizeObjects(
      doc,
      new Map([
        [id!, { x: before!.x, y: before!.y, width: before!.width! * 2, height: before!.height! * 2 }],
      ]),
    );
    expect(ok).toBe(1);

    const after = strokeSnapshot(doc, id!);
    expect(after).not.toBeNull();
    const afterPts = scaledPoints(after!);
    expect(after!.width).toBe(before!.width! * 2);
    expect(after!.height).toBe(before!.height! * 2);
    for (let i = 0; i < beforePts.length; i++) {
      const bx = beforePts[i].x - before!.x;
      const by = beforePts[i].y - before!.y;
      const ax = afterPts[i].x - after!.x;
      const ay = afterPts[i].y - after!.y;
      expect(ax).toBeCloseTo(bx * 2);
      expect(ay).toBeCloseTo(by * 2);
    }
    // Thickness is a field, never scaled (pen.resize).
    expect(after!.thickness).toBe('thin');
    expect(PEN_THICKNESS_WORLD[after!.thickness]).toBe(PEN_THICKNESS_WORLD.thin);
  });

  it('TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'test',
    );
    expect(id).not.toBeNull();
    const snap = strokeSnapshot(doc, id!);
    expect(snap).not.toBeNull();
    const pts = scaledPoints(snap!);

    const zoom = 1;
    const tolerance = Math.max(PEN_THICKNESS_MEDIUM_HALF, STROKE_HIT_TOLERANCE_PX / zoom);
    const d = (q: { x: number; y: number }) => distanceToPolyline(pts, q);
    expect(d({ x: 50, y: 0 })).toBeLessThanOrEqual(tolerance); // on the line
    expect(d({ x: 50, y: 5.9 })).toBeLessThanOrEqual(tolerance); // within 6 px
    expect(d({ x: 50, y: 6.1 })).toBeGreaterThan(tolerance); // outside
  });
});
