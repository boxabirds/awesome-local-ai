import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { simplify, smoothPath, splitPoints } from '../../src/shared/geometry/simplify';
import { type StrokeSnap, createStroke, isStroke, scaledPoints } from '../../src/shared/objects/stroke';
import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function strokeSnap(doc: Y.Doc, id: string): StrokeSnap {
  const s = objectsSnapshot(doc).find((o) => o.id === id);
  if (!s || !isStroke(s)) throw new Error('no stroke');
  return s;
}

const line = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: (i * 7) % 3 }));

describe('stroke.model simplify', () => {
  it('TC-01 the handwritten loop at tolerance 1: every raw point within 1 unit, fewer points', () => {
    const raw = handwrittenLoop();
    const out = simplify(raw, 1);
    expect(out.length).toBeLessThan(raw.length);
    expect(out[0]).toEqual(raw[0]);
    expect(out.at(-1)).toEqual(raw.at(-1));
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1);
  });

  it('TC-02 at 200% zoom (tolerance 0.5): every raw point within 0.5 unit', () => {
    for (const raw of [handwrittenLoop(), underline()]) {
      const out = simplify(raw, 1 / 2);
      expect(out.length).toBeLessThan(raw.length);
      for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(0.5);
    }
  });

  it('simplify handles 5,010 points without recursion and keeps one or two points as they are', () => {
    const raw = spiral();
    const out = simplify(raw, 1);
    for (const p of raw) expect(distanceToPolyline(out, p)).toBeLessThanOrEqual(1);
    expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('stroke.model splitPoints', () => {
  it('TC-03 at STROKE_MAX_POINTS − 1, exactly and + 1 → 1, 1, 2 parts; part 2 starts at part 1’s last point', () => {
    expect(splitPoints(line(STROKE_MAX_POINTS - 1))).toHaveLength(1);
    expect(splitPoints(line(STROKE_MAX_POINTS))).toHaveLength(1);
    const raw = line(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(raw);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(STROKE_MAX_POINTS);
    expect(parts[1]![0]).toEqual(parts[0]!.at(-1));
    expect(parts[1]!.at(-1)).toEqual(raw.at(-1));
    // No point is lost: the parts minus their shared join points are the input.
    expect(parts[0]!.length + parts[1]!.length - 1).toBe(raw.length);
    expect(splitPoints(spiral())).toHaveLength(2);
  });
});

describe('stroke.model createStroke', () => {
  it('TC-04 one point, thick → a dot: bbox = thickness square centred on it, points length 2', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const id = createStroke(doc, { points: [{ x: 100, y: 50 }], color: 'red', thickness: 'thick' }, 'g_priya')!;
    expect(id).toEqual(expect.any(String));
    expect(updates.count).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const t = PEN_THICKNESS_WORLD.thick;
    const s = strokeSnap(doc, id);
    expect(s).toMatchObject({ x: 100 - t / 2, y: 50 - t / 2, width: t, height: t, color: 'red', thickness: 'thick' });
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 50 }]);
    expect(objectsMap(doc).get(id)!.get('createdBy')).toBe('g_priya');
  });

  it('a stroke’s bbox is its points’ bounds padded by half the thickness, and it goes on top', () => {
    const doc = newDoc();
    const first = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'thin' }, 'g')!;
    const id = createStroke(doc, { points: [{ x: 10, y: 20 }, { x: 110, y: 70 }], color: 'blue', thickness: 'medium' }, 'g')!;
    const s = strokeSnap(doc, id);
    expect(s).toMatchObject({ x: 8, y: 18, width: 104, height: 54, baseWidth: 104, baseHeight: 54 });
    expect(s.z).toBeGreaterThan(strokeSnap(doc, first).z);
    expect(scaledPoints(s)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 70 },
    ]);
  });

  it('TC-05 empty points, a NaN point, colour "pink", thickness "huge" → null, zero updates', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const ok = [{ x: 0, y: 0 }];
    expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }], color: 'black', thickness: 'medium' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: [{ x: Infinity, y: 0 }], color: 'black', thickness: 'medium' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'pink' as never, thickness: 'medium' }, 'g')).toBeNull();
    expect(createStroke(doc, { points: ok, color: 'black', thickness: 'huge' as never }, 'g')).toBeNull();
    expect(updates.count).toBe(0);
    expect(objectsMap(doc).size).toBe(0);
  });

  it('TC-06 scaledPoints after width and height doubled → coordinates doubled, thickness unchanged', () => {
    const doc = newDoc();
    const raw = underline();
    const id = createStroke(doc, { points: raw, color: 'green', thickness: 'medium' }, 'g')!;
    const before = strokeSnap(doc, id);
    const obj = objectsMap(doc).get(id)!;
    doc.transact(() => {
      obj.set('width', before.width * 2);
      obj.set('height', before.height * 2);
    }, LOCAL_ORIGIN);
    const after = strokeSnap(doc, id);
    const a = scaledPoints(before);
    const b = scaledPoints(after);
    expect(b).toHaveLength(a.length);
    b.forEach((p, i) => {
      expect(p.x - after.x).toBeCloseTo((a[i]!.x - before.x) * 2, 9);
      expect(p.y - after.y).toBeCloseTo((a[i]!.y - before.y) * 2, 9);
    });
    expect(after.thickness).toBe('medium');
    expect(after.points).toEqual(before.points);
  });

  it('TC-07 distanceToPolyline on scaledPoints at 0, 5.9 and 6.1 units → within, within, outside at zoom 1', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 100 }, { x: 200, y: 100 }], color: 'black', thickness: 'medium' }, 'g')!;
    const pts = scaledPoints(strokeSnap(doc, id));
    const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1);
    expect(distanceToPolyline(pts, { x: 100, y: 100 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(pts, { x: 100, y: 105.9 })).toBeLessThanOrEqual(tolerance);
    expect(distanceToPolyline(pts, { x: 100, y: 106.1 })).toBeGreaterThan(tolerance);
  });

  it('a stored stroke without usable points is not in the snapshot', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'medium' }, 'g')!;
    doc.transact(() => objectsMap(doc).get(id)!.set('points', [1, NaN]));
    expect(objectsSnapshot(doc).find((o) => o.id === id)).toBeUndefined();
  });
});

describe('stroke.model smoothPath', () => {
  it('TC-08 three points → deterministic path starting with M and using Q segments', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const d = smoothPath(pts);
    expect(d).toBe('M 0 0 Q 10 10 15 5 L 20 0');
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(smoothPath(pts)).toBe(d);
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4 L 3 4');
  });
});
