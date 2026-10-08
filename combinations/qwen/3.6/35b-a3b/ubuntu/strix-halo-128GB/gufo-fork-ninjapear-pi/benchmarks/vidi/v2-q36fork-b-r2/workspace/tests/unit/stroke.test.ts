import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { simplify, splitPoints, smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import type { Point } from '../../src/shared/geometry';
import { STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { handwrittenLoop, underlinePath, spiral5010 } from '../fixtures/pen-paths';

describe('TC-01 — simplify loop at tolerance 1', () => {
  it('every raw point within 1 unit of result; result has fewer points', () => {
    const pts = handwrittenLoop();
    const result = simplify(pts, 1);
    expect(result.length).toBeLessThan(pts.length);
    // Every original point must be within tolerance 1 of the simplified path
    for (const p of pts) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(1);
    }
  });
});

describe('TC-02 — simplify at zoom-scaled tolerance 0.5 (zoom 200%)', () => {
  it('every raw point within 0.5 units of result', () => {
    const pts = handwrittenLoop();
    const result = simplify(pts, 0.5);
    for (const p of pts) {
      const dist = distanceToPolyline(result, p);
      expect(dist).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('TC-03 — splitPoints boundary: count − 1 / exactly / + 1', () => {
  it('STROKE_MAX_POINTS - 1 → 1 part', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS - 1 }, (_, i) => ({ x: i, y: i }));
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('STROKE_MAX_POINTS exactly → 1 part', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS }, (_, i) => ({ x: i, y: i }));
    const parts = splitPoints(pts);
    expect(parts.length).toBe(1);
  });

  it('STROKE_MAX_POINTS + 1 → 2 parts, share join point', () => {
    const pts = Array.from({ length: STROKE_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    const parts = splitPoints(pts);
    expect(parts.length).toBe(2);
    // Part 2's first point should equal part 1's last point
    const p1Last = parts[0][parts[0].length - 1];
    const p2First = parts[1][0];
    expect(p1Last.x).toBe(p2First.x);
    expect(p1Last.y).toBe(p2First.y);
  });
});

describe('TC-04 — createStroke single point thick → dot', () => {
  it('bbox = thickness square; points length 2', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const opts = {
      points: [{ x: 100, y: 100 }],
      color: 'black' as const,
      thickness: 'thick' as const,
    };
    const id = createStroke(doc, opts, 'test-user');

    expect(id).toBeTruthy();

    const obj = doc.getMap('objects').get(id!) as Y.Map<any>;
    expect(obj.get('type')).toBe('stroke');
    // Thick = 8 → bbox is 8×8 centred on (100,100): x=96, y=96, w=8, h=8
    expect(obj.get('x')).toBe(96);
    expect(obj.get('y')).toBe(96);
    expect(obj.get('width')).toBe(8);
    expect(obj.get('height')).toBe(8);
    // Points stored relative to bbox origin: [100-96, 100-96] = [4, 4]
    const pts = obj.get('points') as number[];
    expect(pts.length).toBe(2);
    expect(pts[0]).toBeCloseTo(4);
    expect(pts[1]).toBeCloseTo(4);
  });
});

describe('TC-05 — invalid input → null, zero updates', () => {
  it('empty points', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const opts: any = { points: [], color: 'black', thickness: 'medium' };
    expect(createStroke(doc, opts, 'u')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('NaN point', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const opts: any = { points: [{ x: NaN, y: 0 }], color: 'black', thickness: 'medium' };
    expect(createStroke(doc, opts, 'u')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('unknown colour "pink"', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const opts: any = { points: [{ x: 0, y: 0 }], color: 'pink', thickness: 'medium' };
    expect(createStroke(doc, opts, 'u')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('unknown thickness "huge"', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const opts: any = { points: [{ x: 0, y: 0 }], color: 'black', thickness: 'huge' };
    expect(createStroke(doc, opts, 'u')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('TC-06 — scaledPoints after width & height doubled', () => {
  it('coordinates doubled, thickness unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const pts: Point[] = [];
    for (let i = 0; i < 10; i++) {
      pts.push({ x: i * 10, y: i * 5 });
    }
    const id = createStroke(doc, {
      points: pts,
      color: 'blue' as const,
      thickness: 'thin' as const,
    }, 'u');

    const obj = doc.getMap('objects').get(id!) as Y.Map<any>;
    const baseWidth = obj.get('baseWidth') as number;
    const baseHeight = obj.get('baseHeight') as number;
    const bx = obj.get('x') as number;
    const by = obj.get('y') as number;

    // Build Snap with width/height exactly 2× the base
    const snap: any = {
      id: id!,
      type: 'stroke',
      x: bx,
      y: by,
      width: baseWidth * 2,
      height: baseHeight * 2,
      z: 1,
      points: obj.get('points'),
      baseWidth,
      baseHeight,
      color: 'blue',
      thickness: 'thin',
    };

    const scaled = scaledPoints(snap);
    // With 2× width/height, scale factors are both 2
    // Points stored relative to bbox origin (bx, by), so scaled[i] should be
    // (original_rel_i * 2) + box_origin
    const rawPts = obj.get('points') as number[];
    for (let i = 0; i < pts.length; i++) {
      const relX = rawPts[i * 2];
      const relY = rawPts[i * 2 + 1];
      // After scaling: (relX * 2 + bx, relY * 2 + by)
      expect(scaled[i].x).toBeCloseTo(relX * 2 + bx, 1);
      expect(scaled[i].y).toBeCloseTo(relY * 2 + by, 1);
    }
  });
});

describe('TC-07 — distanceToPolyline on scaledPoints', () => {
  it('horizontal line: distance 0, 5.9, 6.1 at zoom 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Horizontal line from (0,0) to (100,0), thickness medium=4
    const pts: Point[] = [];
    for (let i = 0; i <= 100; i += 5) {
      pts.push({ x: i, y: 0 });
    }
    const id = createStroke(doc, {
      points: pts,
      color: 'black' as const,
      thickness: 'medium' as const,
    }, 'u');

    const obj = doc.getMap('objects').get(id!) as Y.Map<any>;
    const snap: any = {
      id: id!,
      type: 'stroke',
      x: obj.get('x'),
      y: obj.get('y'),
      width: obj.get('width'),
      height: obj.get('height'),
      z: 1,
      points: obj.get('points'),
      baseWidth: obj.get('baseWidth'),
      baseHeight: obj.get('baseHeight'),
      color: 'black',
      thickness: 'medium',
    };

    const scaled = scaledPoints(snap);

    // At world y=0 (on the line), distance should be 0
    expect(distanceToPolyline(scaled, { x: 50, y: 0 })).toBeCloseTo(0, 2);

    // At world y=5.9 (within 6 px hit tolerance at zoom 1)
    const dist59 = distanceToPolyline(scaled, { x: 50, y: 5.9 });
    expect(dist59).toBeLessThanOrEqual(STROKE_HIT_TOLERANCE_PX);

    // At world y=6.1 (outside tolerance)
    const dist61 = distanceToPolyline(scaled, { x: 50, y: 6.1 });
    expect(dist61).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

describe('TC-08 — smoothPath of 3 points', () => {
  it('deterministic string starting with M using Q segments', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ];
    const svg = smoothPath(pts);
    expect(svg).toMatch(/^M0,0/);
    expect(svg).toContain('Q');
    // Should end at the last point
    expect(svg).toContain('L20,10');
  });
});
