/**
 * Story 11 unit tests: the stroke model (TC-04 to TC-06), the simplify and
 * split geometry (TC-01 to TC-03), the selection hit tolerance (TC-07) and
 * the smooth-path output (TC-08), per the design's test contract.
 *
 * Camera-independent: everything is in world units (the zoom-1 fixture).
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import {
  createStroke,
  scaledPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { snapshotAll } from '../../src/shared/board-model';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

/** A fresh in-memory doc with the board maps (never connected). */
function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getMap('objects');
  return doc;
}

function strokeSnap(doc: Y.Doc, index: number): StrokeSnap {
  const all = snapshotAll(doc);
  expect(all.length).toBeGreaterThan(index);
  return all[index] as StrokeSnap;
}

describe('simplify (TC-01, TC-02)', () => {
  it('TC-01: the handwritten loop loses points but every raw point stays within 1 unit of the result', () => {
    const loop = handwrittenLoop();
    const result = simplify(loop, 1);
    expect(result.length).toBeLessThan(loop.length);
    // The endpoints are kept (they anchor the drawn shape).
    expect(result[0]).toEqual(loop[0]);
    expect(result[result.length - 1]).toEqual(loop[loop.length - 1]);
    for (const raw of loop) {
      const d = distanceToPolyline(result, raw);
      expect(d, `raw point (${raw.x}, ${raw.y})`).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('TC-02: tolerance 0.5 keeps every raw point within 0.5 units', () => {
    const loop = handwrittenLoop();
    const result = simplify(loop, 0.5);
    for (const raw of loop) {
      const d = distanceToPolyline(result, raw);
      expect(d, `raw point (${raw.x}, ${raw.y})`).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('splitPoints (TC-03)', () => {
  it('TC-03: 5010 points split into two parts; part 2 starts at part 1’s last point', () => {
    // Below the limit: a single part.
    expect(splitPoints(longSpiral(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(longSpiral(STROKE_MAX_POINTS))).toHaveLength(1);

    // One point over the limit: two parts.
    const raw = longSpiral(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(raw);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1].length).toBeGreaterThan(0);
    // The parts join at the shared boundary point (no visible gap).
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
    // The last point is preserved.
    expect(parts[1][parts[1].length - 1]).toEqual(raw[raw.length - 1]);
    // With the default max (STROKE_MAX_POINTS).
    expect(splitPoints(raw)).toHaveLength(2);
    // A path exactly at the limit plus one stride: the join is shared once.
    const parts4000 = splitPoints(longSpiral(8001), 4000);
    expect(parts4000).toHaveLength(3);
    expect(parts4000[0]).toHaveLength(4000);
    expect(parts4000[1][0]).toEqual(parts4000[0][3999]);
    expect(parts4000[2][0]).toEqual(parts4000[1][3999]);
  });
});

describe('createStroke (TC-04, TC-05)', () => {
  it('TC-04: a dot click commits a square stroke of the thickness and is snapshot-able', () => {
    const doc = makeDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 10, y: 20 }], color: 'black', thickness: 'thick' },
      'tester',
    );
    expect(id).toBeTypeOf('string');
    const snap = strokeSnap(doc, 0);
    expect(snap.type).toBe('stroke');
    expect(snap.id).toBe(id);
    expect(snap.color).toBe('black');
    expect(snap.thickness).toBe('thick');
    const t = PEN_THICKNESS_WORLD.thick;
    // A dot is a square: thickness × thickness (the bbox pads the point).
    expect(snap.width).toBe(t);
    expect(snap.height).toBe(t);
    expect(snap.x).toBe(10 - t / 2);
    expect(snap.y).toBe(20 - t / 2);
    // The stored point is the centre of the square (relative to the origin).
    expect(snap.points).toEqual([t / 2, t / 2]);
    // scaledPoints round-trips to the drawn point.
    expect(scaledPoints(snap)).toEqual([{ x: 10, y: 20 }]);
  });

  it('TC-05: empty points / non-finite points / unknown options create nothing and write no update', () => {
    const doc = makeDoc();
    const updates = vi.fn();
    doc.on('update', updates);
    expect(
      createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'tester'),
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: Number.NaN, y: 0 }], color: 'black', thickness: 'medium' },
        'tester',
      ),
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: 1, y: Number.POSITIVE_INFINITY }], color: 'black', thickness: 'medium' },
        'tester',
      ),
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: 1, y: 2 }], color: 'pink' as never, thickness: 'medium' },
        'tester',
      ),
    ).toBeNull();
    expect(
      createStroke(
        doc,
        { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' as never },
        'tester',
      ),
    ).toBeNull();
    // Nothing was written: no Y updates, empty snapshots.
    expect(updates).not.toHaveBeenCalled();
    expect(snapshotAll(doc)).toHaveLength(0);
  });
});

describe('scaledPoints (TC-06)', () => {
  it('TC-06: proportional resize doubles the coordinates and never scales thickness', () => {
    const doc = makeDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 4, y: 4 }, { x: 14, y: 14 }], color: 'black', thickness: 'medium' },
      'tester',
    );
    expect(id).not.toBeNull();
    const beforeSnap = strokeSnap(doc, 0);
    const before = scaledPoints(beforeSnap);
    expect(before).toEqual([
      { x: 4, y: 4 },
      { x: 14, y: 14 },
    ]);

    // Double the bbox with the origin fixed (the aspect-locked corner-drag
    // shape); the path scales relative to the object's origin.
    const ox = beforeSnap.x;
    const oy = beforeSnap.y;
    doc.transact(() => {
      const entry = doc.getMap('objects').get(id as string) as Y.Map<unknown>;
      entry.set('width', (entry.get('width') as number) * 2);
      entry.set('height', (entry.get('height') as number) * 2);
    });
    const afterSnap = strokeSnap(doc, 0);
    expect(afterSnap.x).toBe(ox);
    expect(afterSnap.y).toBe(oy);
    const after = scaledPoints(afterSnap);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x, `point ${i} x`).toBe(ox + (before[i].x - ox) * 2);
      expect(after[i].y, `point ${i} y`).toBe(oy + (before[i].y - oy) * 2);
    }
    // Thickness is untouched by the resize.
    expect(afterSnap.thickness).toBe('medium');
  });
});

describe('selection hit tolerance (TC-07)', () => {
  it('TC-07: 5px is within the tolerance and 7px is not (50% and 200% zoom)', () => {
    const doc = makeDoc();
    createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'tester',
    );
    const line = scaledPoints(strokeSnap(doc, 0));
    // The registry tolerance (pen.select): max(thickness/2, 6/zoom).
    const zooms = [0.5, 1, 2];
    for (const zoom of zooms) {
      const tolerance = Math.max(
        PEN_THICKNESS_WORLD.medium / 2,
        STROKE_HIT_TOLERANCE_PX / zoom,
      );
      const within5 = distanceToPolyline(line, { x: 50, y: 5 / zoom }) <= tolerance;
      const within7 = distanceToPolyline(line, { x: 50, y: 7 / zoom }) <= tolerance;
      expect(within5, `zoom ${zoom}: 5px`).toBe(true);
      expect(within7, `zoom ${zoom}: 7px`).toBe(false);
    }
  });
});

describe('smoothPath (TC-08)', () => {
  it('TC-08: returns a smooth SVG path (Q segments) that is deterministic', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('Q ');
    // Deterministic: the same input yields the exact same path string.
    expect(smoothPath(pts)).toBe(d);
    // A single point renders as a dot (zero-length segment, round caps).
    expect(smoothPath([{ x: 3, y: 4 }])).toContain('M ');
    // Two points: a straight segment.
    const two = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(two).toContain('L ');
    expect(two).not.toContain('Q ');
  });
});
