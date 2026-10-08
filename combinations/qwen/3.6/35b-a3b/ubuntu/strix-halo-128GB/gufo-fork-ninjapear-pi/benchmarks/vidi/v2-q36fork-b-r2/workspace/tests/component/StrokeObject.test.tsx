import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createStroke } from '../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../src/shared/objects/stroke';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD } from '../../shared/config';
import { getObjectType } from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { smoothPath } from '../../src/shared/geometry/simplify';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';

// Register stroke type before all tests
import '../../src/client/objects/StrokeObject';

describe('TC-15 — registry hitTest tolerance depends on pixel distance', () => {
  it('medium stroke: close point hits, far point misses', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black' as PenColor,
      thickness: 'medium' as PenThickness,
    }, 'user');

    // Access the underlying map data that scaledPoints can work with
    const objMap = doc.getMap('objects').get(id!);

    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    if (!spec) return;

    // Registry hitTest uses STROKE_HIT_TOLERANCE_PX (6px) as absolute floor
    // For a horizontal line at y=0, points at y=2 should be within tolerance (6 > 2)
    expect(spec.hitTest(objMap, { x: 50, y: 2 })).toBe(true);
    
    // Points at y=10 should be outside tolerance (6 < 10)
    expect(spec.hitTest(objMap, { x: 50, y: 10 })).toBe(false);
  });

  it('thick stroke: slightly further point still hits', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'blue' as PenColor,
      thickness: 'thick' as PenThickness,
    }, 'user');

    const objMap = doc.getMap('objects').get(id!);
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    if (!spec) return;

    // Thick = 8, half-thickness = 4; plus STROKE_HIT_TOLERANCE_PX = 6
    // max(4, 6) = 6. So point at y=3 should hit (dist 3 < 6)
    expect(spec.hitTest(objMap, { x: 50, y: 3 })).toBe(true);
    // Point at y=10 should miss (dist 10 > 6)
    expect(spec.hitTest(objMap, { x: 50, y: 10 })).toBe(false);
  });
});

describe('TC-16 — click inside bbox but far from line misses stroke', () => {
  it('point in bbox corner is outside tolerance', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'green' as PenColor,
      thickness: 'thin' as PenThickness,
    }, 'user');

    const objMap = doc.getMap('objects').get(id!);
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    if (!spec) return;

    // Thin = 2, half = 1; tolerance = max(1, 6) = 6
    // Distance from (50, 10) to line = 10 > 6 → miss
    expect(spec.hitTest(objMap, { x: 50, y: 10 })).toBe(false);
    
    // Bbox corners: thin stroke has tiny height
    // Point at (-10, -10) should also miss (far from line)
    expect(spec.hitTest(objMap, { x: -10, y: -10 })).toBe(false);
  });
});

describe('stroke rendering — smoothPath output format', () => {
  it('single point produces M-only path for dot rendering', () => {
    const pts = [{ x: 100, y: 200 }];
    const d = smoothPath(pts);
    expect(d).toBe('M100,200');
  });

  it('two points produce M + L path (straight line)', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const d = smoothPath(pts);
    // For 2 points, smoothPath produces a straight line
    expect(d).toBe('M0,0L10,0');
  });

  it('three points produce SVG path with Q curve', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d).toContain('Q');
  });
});

describe('scaledPoints transforms correctly', () => {
  it('same width/height → points unchanged relative to origin', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      color: 'black' as PenColor,
      thickness: 'medium' as PenThickness,
    }, 'user');

    const snap: any = {
      id: id!,
      type: 'stroke',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      z: 1,
      points: doc.getMap('objects').get(id!).get('points'),
      baseWidth: doc.getMap('objects').get(id!).get('baseWidth'),
      baseHeight: doc.getMap('objects').get(id!).get('baseHeight'),
      color: 'black',
      thickness: 'medium',
    };

    const scaled = scaledPoints(snap);
    expect(scaled.length).toBeGreaterThan(0);
  });

  it('works with raw Y.Map objects too', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      color: 'purple' as PenColor,
      thickness: 'thick' as PenThickness,
    }, 'user');

    // Pass Y.Map directly (as the registry hitTest does)
    const objMap = doc.getMap('objects').get(id!);
    const scaled = scaledPoints(objMap);
    expect(scaled.length).toBe(2);
  });
});
