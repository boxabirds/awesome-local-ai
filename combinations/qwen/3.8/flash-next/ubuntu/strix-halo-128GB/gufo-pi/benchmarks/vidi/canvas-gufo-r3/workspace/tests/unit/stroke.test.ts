import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '@shared/geometry/simplify';
import { createStroke, scaledPoints, snapshotStroke, type StrokeSnap } from '@shared/objects/stroke';
import { initDoc, LOCAL_ORIGIN } from '@shared/board-model';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD } from '@shared/config';
import { handwrittenLoop, underlineFixture, spiralFixture } from '../fixtures/pen-paths';
import type { Point } from '@client/canvas/camera';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const handler = () => n++;
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return n;
}

describe('stroke model (TC-01 to TC-08)', () => {
  it('TC-01: simplify handwritten loop at tolerance 1 — every raw point within 1 unit of result, fewer points', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);
    expect(result.length).toBeLessThan(raw.length);
    expect(result[0]).toEqual(raw[0]);
    expect(result[result.length - 1]).toEqual(raw[raw.length - 1]);
    // Every raw point must be within 1 unit of the result polyline
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('TC-02: simplify at tolerance 0.5 (zoom 200%) — every raw point within 0.5', () => {
    const raw = underlineFixture();
    const result = simplify(raw, 0.5);
    expect(result.length).toBeLessThanOrEqual(raw.length);
    for (const p of raw) {
      const d = distanceToPolyline(result, p);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });

  it('TC-03: splitPoints at STROKE_MAX_POINTS - 1, exactly, + 1 — 1, 1, 2 parts; part 2 starts with part 1 last point', () => {
    const pts = spiralFixture(STROKE_MAX_POINTS - 1);
    expect(splitPoints(pts, STROKE_MAX_POINTS).length).toBe(1);

    const pts2 = spiralFixture(STROKE_MAX_POINTS);
    expect(splitPoints(pts2, STROKE_MAX_POINTS).length).toBe(1);

    const pts3 = spiralFixture(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(pts3, STROKE_MAX_POINTS);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(STROKE_MAX_POINTS);
    // part 2 starts with part 1's last point
    expect(parts[1][0]).toEqual(parts[0][parts[0].length - 1]);
  });

  it('TC-04: createStroke single point thick — bbox is thickness square, points length 2', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'black', thickness: 'thick' }, 'user');
    expect(id).not.toBeNull();
    const strokes = snapshotStroke(doc);
    expect(strokes.length).toBe(1);
    const s = strokes[0];
    expect(s.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(s.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(s.points.length).toBe(2);
  });

  it('TC-05: createStroke invalid input — empty points, NaN, unknown colour/thickness returns null, zero updates', () => {
    const doc = makeDoc();
    const u1 = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'user')).toBeNull();
    });
    expect(u1).toBe(0);

    const u2 = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [{ x: NaN, y: 10 }], color: 'black', thickness: 'medium' }, 'user')).toBeNull();
    });
    expect(u2).toBe(0);

    const u3 = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'pink' as any, thickness: 'medium' }, 'user')).toBeNull();
    });
    expect(u3).toBe(0);

    const u4 = countUpdates(doc, () => {
      expect(createStroke(doc, { points: [{ x: 1, y: 2 }], color: 'black', thickness: 'huge' as any }, 'user')).toBeNull();
    });
    expect(u4).toBe(0);
  });

  it('TC-06: scaledPoints after width and height doubled — coordinates doubled, thickness unchanged', () => {
    const doc = makeDoc();
    const raw: Point[] = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 10 }];
    const id = createStroke(doc, { points: raw, color: 'black', thickness: 'medium' }, 'user');
    expect(id).not.toBeNull();
    const strokes = snapshotStroke(doc);
    const s = strokes[0];
    // Simulate resize: double width and height
    const resized: StrokeSnap = { ...s, width: s.width * 2, height: s.height * 2 };
    const scaled = scaledPoints(resized);
    const orig = scaledPoints(s);
    // Each scaled coordinate should be doubled relative to the bbox origin
    for (let i = 0; i < scaled.length; i++) {
      expect(scaled[i].x).toBeCloseTo(orig[i].x * 2 - s.x);
      expect(scaled[i].y).toBeCloseTo(orig[i].y * 2 - s.y);
    }
    expect(resized.thickness).toBe('medium');
  });

  it('TC-07: distanceToPolyline on scaledPoints at 0, 5.9, 6.1 units — within/within/outside at zoom 1', () => {
    const doc = makeDoc();
    // Create a horizontal line from (100,100) to (300,100)
    const raw: Point[] = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }];
    const id = createStroke(doc, { points: raw, color: 'black', thickness: 'medium' }, 'user');
    expect(id).not.toBeNull();
    const strokes = snapshotStroke(doc);
    const s = strokes[0];
    const pts = scaledPoints(s);

    // Distance 0 (on the line)
    expect(distanceToPolyline(pts, { x: 200, y: 100 })).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Distance 5.9 units
    const d59 = distanceToPolyline(pts, { x: 200, y: 105.9 });
    expect(d59).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // Distance 6.1 units
    const d61 = distanceToPolyline(pts, { x: 200, y: 106.1 });
    expect(d61).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('TC-08: smoothPath of 3 points — deterministic string starting with M and using Q segments', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 5 }];
    const path = smoothPath(pts);
    expect(path).toMatch(/^M/);
    expect(path).toContain('Q');
    // Deterministic: same input always yields same output
    expect(smoothPath(pts)).toBe(path);
  });
});
