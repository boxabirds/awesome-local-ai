import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  objectSnapshot,
  resizeObjects,
  LOCAL_ORIGIN,
} from '@/shared/board-model';
import {
  createStroke,
  isStrokeSnap,
  scaledPoints,
  type StrokeSnap,
} from '@/shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '@/shared/geometry/simplify';
import { distanceToPolyline } from '@/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '@/shared/config';
import { HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths';
import type { Point } from '@/shared/geometry';
import type { PenColor, PenThickness } from '@/shared/objects/stroke';

/**
 * Story 11 stroke-model unit tests (TC-01 to TC-08).
 *
 * All inputs are deterministic; the fixtures are recorded realistic pointer
 * paths (tests/fixtures/pen-paths.ts).
 */

function makeDoc(): { doc: Y.Doc; updates: Array<{ bytes: Uint8Array; origin: unknown }> } {
  const doc = new Y.Doc();
  const updates: Array<{ bytes: Uint8Array; origin: unknown }> = [];
  doc.on('update', (bytes, origin) => updates.push({ bytes, origin }));
  initDoc(doc);
  return { doc, updates };
}

function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const snap = objectSnapshot(doc).find((o) => o.id === id);
  if (snap === undefined || !isStrokeSnap(snap)) throw new Error(`stroke ${id} not found`);
  return snap;
}

const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('simplify (pen.smooth)', () => {
  it('TC-01: the handwritten loop at tolerance 1 unit -> shorter polyline, every raw point within 1 unit', () => {
    const out = simplify(HANDWRITTEN_LOOP, 1);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(HANDWRITTEN_LOOP.length);
    // Endpoints are always kept.
    expect(out[0]).toEqual(HANDWRITTEN_LOOP[0]);
    expect(out[out.length - 1]).toEqual(HANDWRITTEN_LOOP[HANDWRITTEN_LOOP.length - 1]);
    for (const p of HANDWRITTEN_LOOP) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('TC-02: the underline at tolerance 1/zoom = 0.5 (200% zoom) -> every raw point within 0.5 units', () => {
    const out = simplify(UNDERLINE, 0.5);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(UNDERLINE.length);
    for (const p of UNDERLINE) {
      expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('splitPoints (pen.long_stroke)', () => {
  it('TC-03: STROKE_MAX_POINTS - 1, exactly, and + 1 -> 1, 1 and 2 parts; parts join seamlessly', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);

    const exact = splitPoints(line(STROKE_MAX_POINTS));
    expect(exact).toHaveLength(1);
    expect(exact[0]).toHaveLength(STROKE_MAX_POINTS);

    const over = splitPoints(line(STROKE_MAX_POINTS + 1));
    expect(over).toHaveLength(2);
    expect(over[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(over[1]).toHaveLength(2);
    // The second stroke starts at the shared point (no visible gap).
    expect(over[1][0]).toEqual(over[0][over[0].length - 1]);
  });
});

describe('createStroke (pen.dot, stroke.model)', () => {
  let doc: Y.Doc;
  let updates: Array<{ bytes: Uint8Array; origin: unknown }>;

  beforeEach(() => {
    ({ doc, updates } = makeDoc());
  });

  it('TC-04: a single point becomes a thickness x thickness square centred on it', () => {
    const t = PEN_THICKNESS_WORLD.thick;
    const id = createStroke(doc, { points: [{ x: 10, y: -5 }], color: 'black', thickness: 'thick' }, 'tester');
    expect(id).not.toBeNull();
    const s = strokeSnap(doc, id!);
    expect(s.width).toBe(t);
    expect(s.height).toBe(t);
    expect(s.x).toBe(10 - t / 2);
    expect(s.y).toBe(-5 - t / 2);
    // The point is stored relative to the bbox origin: centred.
    expect(s.points).toEqual([t / 2, t / 2]);
    // Exactly one LOCAL_ORIGIN transaction for the creation.
    const local = updates.filter((u) => u.origin === LOCAL_ORIGIN);
    expect(local).toHaveLength(1);
    expect(s.z).toBe(1);
    expect(s.createdBy).toBe('tester');
  });

  it('TC-05: invalid input -> null and zero updates', () => {
    const cases: Array<{ points: Point[]; color?: PenColor; thickness?: PenThickness }> = [
      { points: [] },
      { points: [{ x: Number.NaN, y: 0 }] },
      { points: [{ x: 1, y: Number.POSITIVE_INFINITY }] },
      { points: [{ x: 1, y: 1 }], color: 'pink' as PenColor },
      { points: [{ x: 1, y: 1 }], thickness: 'huge' as PenThickness },
    ];
    for (const a of cases) {
      expect(createStroke(doc, { points: a.points, color: a.color ?? 'black', thickness: a.thickness ?? 'medium' }, 'tester')).toBeNull();
    }
    expect(updates.filter((u) => u.origin === LOCAL_ORIGIN)).toHaveLength(0);
    expect(objectSnapshot(doc).filter((o) => o.type === 'stroke')).toHaveLength(0);
  });

  it('a multi-point stroke: bbox = point bounds padded by half the thickness; z stacks above existing objects', () => {
    const id1 = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], color: 'blue', thickness: 'thin' }, 'a');
    const id2 = createStroke(doc, { points: [{ x: -5, y: 5 }], color: 'red', thickness: 'thick' }, 'b');
    expect(id2).not.toBeNull();
    const s1 = strokeSnap(doc, id1!);
    const t = PEN_THICKNESS_WORLD.thin;
    expect(s1.x).toBe(-t / 2);
    expect(s1.y).toBe(-t / 2);
    expect(s1.width).toBe(20 + t);
    expect(s1.height).toBe(10 + t);
    expect(s1.points).toHaveLength(4);
    const s2 = strokeSnap(doc, id2!);
    expect(s2.z).toBe(s1.z + 1);
  });
});

describe('scaledPoints (pen.resize)', () => {
  it('TC-06: after doubling width and height, coordinates double; thickness is unchanged', () => {
    // Thin (t = 2): point bounds (1,1)..(21,11) -> bbox origin exactly (0,0),
    // so doubling scales the world coordinates about (0,0).
    const d = docOf();
    const id = createStroke(
      d,
      { points: [{ x: 1, y: 1 }, { x: 21, y: 11 }], color: 'black', thickness: 'thin' },
      'tester',
    );
    const s0 = strokeSnap(d, id!);
    expect(s0.x).toBe(0);
    expect(s0.y).toBe(0);
    const before = scaledPoints(s0);
    // Resize to 2x (proportional) via the story-7 group resize.
    resizeObjects(d, new Map([[id!, { x: 0, y: 0, width: s0.width * 2, height: s0.height * 2 }]]));
    const s1 = strokeSnap(d, id!);
    const after = scaledPoints(s1);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i].x).toBeCloseTo(before[i].x * 2, 9);
      expect(after[i].y).toBeCloseTo(before[i].y * 2, 9);
    }
    // The line thickness is a pen setting, not geometry.
    expect(s1.thickness).toBe(s0.thickness);
    // The stored points array is never rewritten by a resize.
    expect(s1.points).toEqual(s0.points);
    expect(s1.baseWidth).toBe(s0.baseWidth);
    expect(s1.baseHeight).toBe(s0.baseHeight);
  });
});

describe('hit tolerance (pen.select)', () => {
  it('TC-07: 0 / 5.9 / 6.1 world units from the line at zoom 1 -> within / within / beyond', () => {
    const { doc: d } = makeDoc();
    // A thin (t = 2) straight line along y = 0 from x = 0 to x = 100.
    const id = createStroke(d, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thin' }, 'tester');
    const s = strokeSnap(d, id!);
    const scaled = scaledPoints(s);
    const halfThickness = PEN_THICKNESS_WORLD[s.thickness] / 2;
    const tolerance = Math.max(halfThickness, STROKE_HIT_TOLERANCE_PX); // zoom = 1
    for (const offset of [0, 5.9, 6.1]) {
      const dist = distanceToPolyline(scaled, { x: 50, y: offset });
      expect(dist).toBeCloseTo(offset, 9);
      if (offset < 6.1) {
        expect(dist).toBeLessThanOrEqual(tolerance);
      } else {
        expect(dist).toBeGreaterThan(tolerance);
      }
    }
  });
});

describe('smoothPath (stroke.model)', () => {
  it('TC-08: three points -> a deterministic path starting M, containing Q, ending at the last point', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('Q');
    // Ends exactly at the last point.
    expect(d.endsWith('20 0')).toBe(true);
    // Deterministic for a deterministic input.
    expect(smoothPath(pts)).toBe(d);
    expect(d).toBe('M 0 0 Q 10 10 15 5 Q 20 0 20 0');
  });

  it('one point -> a zero-length subpath (a round dot with round caps); empty -> empty string', () => {
    expect(smoothPath([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5');
    expect(smoothPath([])).toBe('');
  });
});

// TC-06 needs its own doc (kept outside the createStroke describe scope).
function docOf(): Y.Doc {
  const d = new Y.Doc();
  initDoc(d);
  return d;
}
