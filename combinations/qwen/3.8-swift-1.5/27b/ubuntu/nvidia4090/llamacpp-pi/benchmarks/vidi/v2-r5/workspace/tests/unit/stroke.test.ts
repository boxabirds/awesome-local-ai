// tests/unit/stroke.test.ts
// TC-01 to TC-08: stroke.model contract tests

import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';

// Stub for crypto.randomUUID in test env (if needed)
beforeAll(() => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    (globalThis.crypto as any).randomUUID = () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  }
});

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// TC-01: simplify loop at tolerance 1 → every raw point within 1 unit of result, fewer points
describe('TC-01: simplify at tolerance 1', () => {
  it('every raw point is within 1 unit of the simplified result; result has fewer points', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 1);

    // Result has fewer points
    expect(result.length).toBeLessThan(raw.length);

    // Every raw point is within 1 unit of the result polyline
    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

// TC-02: tolerance 0.5 (zoom 200%) → every raw point within 0.5
describe('TC-02: simplify at tolerance 0.5', () => {
  it('every raw point is within 0.5 units of the simplified result', () => {
    const raw = handwrittenLoop();
    const result = simplify(raw, 0.5);

    for (const p of raw) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

// TC-03: splitPoints at STROKE_MAX_POINTS - 1 / exactly / + 1
describe('TC-03: splitPoints at boundary', () => {
  it('STROKE_MAX_POINTS - 1 → 1 part', () => {
    const pts = longSpiral(STROKE_MAX_POINTS - 1);
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('STROKE_MAX_POINTS exactly → 1 part', () => {
    const pts = longSpiral(STROKE_MAX_POINTS);
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('STROKE_MAX_POINTS + 1 → 2 parts; part 2 starts with part 1\'s last point', () => {
    const pts = longSpiral(STROKE_MAX_POINTS + 1);
    const parts = splitPoints(pts);
    expect(parts.length).toBe(2);

    // Part 2 starts with part 1's last point
    const lastOfPart1 = parts[0][parts[0].length - 1];
    const firstOfPart2 = parts[1][0];
    expect(firstOfPart2.x).toBe(lastOfPart1.x);
    expect(firstOfPart2.y).toBe(lastOfPart1.y);
  });
});

// TC-04: createStroke single point thick → bbox = thickness square, points length 2
describe('TC-04: createStroke single point (dot)', () => {
  it('single point with thick creates a dot with bbox = thickness square', () => {
    const doc = makeDoc();
    const thick = PEN_THICKNESS_WORLD.thick; // 8
    const id = createStroke(doc, { points: [{ x: 100, y: 200 }], color: 'black', thickness: 'thick' }, 'local');

    expect(id).not.toBeNull();
    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    expect(snap).toBeDefined();

    // bbox = thickness square
    expect(snap.width).toBe(thick);
    expect(snap.height).toBe(thick);

    // points array length 2 (one point = x, y)
    expect(snap.points.length).toBe(2);
  });
});

// TC-05: empty points, NaN point, colour 'pink', thickness 'huge' → null
describe('TC-05: invalid input', () => {
  it('empty points → null', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [], color: 'black', thickness: 'medium' }, 'local');
    expect(id).toBeNull();
    expect(snapshot(doc).length).toBe(0);
  });

  it('NaN point → null', () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' }, 'local');
    expect(id).toBeNull();
    expect(snapshot(doc).length).toBe(0);
  });

  it("colour 'pink' → null", () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'pink' as any, thickness: 'medium' }, 'local');
    expect(id).toBeNull();
    expect(snapshot(doc).length).toBe(0);
  });

  it("thickness 'huge' → null", () => {
    const doc = makeDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' as any }, 'local');
    expect(id).toBeNull();
    expect(snapshot(doc).length).toBe(0);
  });
});

// TC-06: scaledPoints after width and height doubled → coordinates doubled, thickness unchanged
describe('TC-06: scaledPoints after resize', () => {
  it('coordinates doubled when width and height doubled; thickness unchanged', () => {
    const doc = makeDoc();
    const pts: Point[] = [
      { x: 10, y: 10 },
      { x: 50, y: 30 },
      { x: 80, y: 60 },
    ];
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'local')!;

    // Get original snap
    let snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const origWidth = snap.width;
    const origHeight = snap.height;
    const origX = snap.x;
    const origY = snap.y;

    // Original world-space points
    const origWorld = scaledPoints(snap);

    // Resize: double width and height (keep x,y the same)
    const objects = doc.getMap('objects');
    const obj = objects.get(id) as Y.Map<unknown>;
    doc.transact(() => {
      obj.set('width', origWidth * 2);
      obj.set('height', origHeight * 2);
    }, LOCAL_ORIGIN);

    snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const scaledWorld = scaledPoints(snap);

    // Verify relative coordinates within bbox are doubled:
    // (worldPoint - bboxOrigin) should be doubled
    for (let i = 0; i < scaledWorld.length; i++) {
      const origRelX = origWorld[i].x - origX;
      const origRelY = origWorld[i].y - origY;
      const newRelX = scaledWorld[i].x - origX; // x doesn't change
      const newRelY = scaledWorld[i].y - origY;
      expect(newRelX).toBeCloseTo(origRelX * 2, 5);
      expect(newRelY).toBeCloseTo(origRelY * 2, 5);
    }

    // Thickness unchanged
    expect(snap.thickness).toBe('medium');
  });
});

// TC-07: distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units
describe('TC-07: hit test distance', () => {
  it('distance 0 → within, 5.9 → within, 6.1 → outside STROKE_HIT_TOLERANCE_PX at zoom 1', () => {
    // Create a simple horizontal stroke from (0,0) to (100,0)
    const doc = makeDoc();
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const id = createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'local')!;
    const snap = snapshot(doc).find(s => s.id === id) as unknown as StrokeSnap;
    const scaled = scaledPoints(snap);

    // Point on the line (distance 0)
    const onLine = { x: 50, y: 0 };
    const d0 = distanceToPolyline(scaled, onLine);
    expect(d0).toBeLessThanOrEqual(Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1));

    // Point 5.9 units away
    const near = { x: 50, y: 5.9 };
    const dNear = distanceToPolyline(scaled, near);
    expect(dNear).toBeLessThanOrEqual(Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1));

    // Point 6.1 units away (beyond 6px tolerance, and medium thickness/2 = 2)
    const far = { x: 50, y: 6.1 };
    const dFar = distanceToPolyline(scaled, far);
    expect(dFar).toBeGreaterThan(Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1));
  });
});

// TC-08: smoothPath of 3 points → deterministic string starting with M and using Q segments
describe('TC-08: smoothPath', () => {
  it('produces a deterministic SVG path starting with M and using Q', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 25 },
      { x: 100, y: 0 },
    ];
    const path = smoothPath(pts);

    expect(path).toMatch(/^M/);
    expect(path).toContain('Q');

    // Deterministic: same input → same output
    const path2 = smoothPath(pts);
    expect(path).toBe(path2);
  });
});
