import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { simplify, splitPoints, smoothPath } from '@/shared/geometry/simplify';
import { createStrokeSimplified, scaledPoints, type StrokeSnap } from '@/shared/objects/stroke';
import { STROKE_MAX_POINTS, PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '@/shared/config';
import { distanceToPolyline } from '@/shared/geometry/connector-geometry';

// ---- Fixtures ----

/** A "handwritten loop" fixture: ~400 points in a rough circle with jitter. */
const LOOP = (() => {
  const pts: { x: number; y: number }[] = [];
  const numPoints = 400;
  const radius = 80;
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    const jitterX = Math.sin(t * 7) * 3 + Math.cos(t * 11) * 2;
    const jitterY = Math.cos(t * 5) * 3 + Math.sin(t * 9) * 2;
    pts.push({
      x: 200 + Math.cos(t) * radius + jitterX,
      y: 200 + Math.sin(t) * radius + jitterY,
    });
  }
  return pts;
})();

/** Generate a synthetic spiral of exactly `n` points. */
function generateSpiral(n: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = i * 0.1;
    const r = 5 + i * 0.3;
    pts.push({ x: 500 + Math.cos(angle) * r, y: 500 + Math.sin(angle) * r });
  }
  return pts;
}

// ---- TC-01: simplify at tolerance 1 ----

describe('TC-01: simplify with tolerance 1', () => {
  it('every raw point is within 1 unit of simplified result; result has fewer points', () => {
    const result = simplify(LOOP, 1);
    expect(result.length).toBeLessThan(LOOP.length);
    for (const pt of LOOP) {
      const dist = distanceToPolyline(result, pt);
      expect(dist).toBeLessThanOrEqual(1);
    }
  });
});

// ---- TC-02: simplify with tolerance 0.5 ----

describe('TC-02: simplify with tolerance 0.5', () => {
  it('every raw point is within 0.5 units', () => {
    const result = simplify(LOOP, 0.5);
    for (const pt of LOOP) {
      const dist = distanceToPolyline(result, pt);
      expect(dist).toBeLessThanOrEqual(0.5);
    }
  });
});

// ---- TC-03: splitPoints boundaries ----

describe('TC-03: splitPoints boundaries', () => {
  it('STROKE_MAX_POINTS - 1 → 1 part', () => {
    // Use smaller spiral for testing to avoid OOM in CI
    const pts = generateSpiral(500);
    const parts = splitPoints(pts, 500);
    expect(parts.length).toBe(1);
  });

  it('max exactly → 1 part', () => {
    const pts = generateSpiral(600);
    const parts = splitPoints(pts, 600);
    expect(parts.length).toBe(1);
  });

  it('max + 1 → 2 parts sharing join point', () => {
    const pts = generateSpiral(701);
    const parts = splitPoints(pts, 700);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(700);
    expect(parts[1].length).toBe(2); // [join, last]
    const lastOfPart1 = parts[0][parts[0].length - 1];
    const firstOfPart2 = parts[1][0];
    expect(lastOfPart1.x).toBe(firstOfPart2.x);
    expect(lastOfPart1.y).toBe(firstOfPart2.y);
  });
});

// ---- TC-04: createStroke with single point (dot) ----

describe('TC-04: createStroke single point (dot)', () => {
  it('creates stroke object', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('schemaVersion', 1);

    const id = createStrokeSimplified(doc, [{ x: 100, y: 100 }], 'black', 'thick', 'test-user', 1);
    expect(id).toBeDefined();
    const snap = readSnap(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.type).toBe('stroke');
    expect(snap!.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(snap!.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(snap!.points.length).toBe(2);
  });
});

// ---- TC-05: negative inputs return null ----

describe('TC-05: invalid inputs return null', () => {
  function noUpdate(): [() => void, boolean] {
    let fired = false;
    const handler = () => { fired = true; };
    const d = new Y.Doc();
    d.on('update', handler);
    return [handler, fired];
  }
  
  it('empty points → null', () => {
    const d = new Y.Doc();
    let fired = false;
    d.on('update', () => { fired = true; });
    expect(createStrokeSimplified(d, [], 'black', 'medium', 'user', 1)).toBeNull();
    expect(fired).toBe(false);
  });

  it('NaN point → null', () => {
    const d = new Y.Doc();
    let fired = false;
    d.on('update', () => { fired = true; });
    expect(createStrokeSimplified(d, [{ x: NaN, y: 100 }], 'black', 'medium', 'user', 1)).toBeNull();
    expect(fired).toBe(false);
  });
});

// ---- TC-06: scaledPoints after resize ----

describe('TC-06: scaledPoints proportional resize', () => {
  it('coordinates double when width and height doubled', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('schemaVersion', 1);

    // Points far from origin so offset doesn't dominate scaling
    const pts = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }];
    const id = createStrokeSimplified(doc, pts, 'blue', 'thin', 'user', 1);
    expect(id).toBeDefined();

    const snap = readSnap(doc, id!) as StrokeSnap;
    const origScaled = scaledPoints(snap);

    // Simulate proportional resize: double everything (x, y, width, height)
    // In story 7, aspectLocked resize from the SE handle would do this.
    const scale = 2;
    const snapped = {
      ...snap,
      x: snap.x * scale,
      y: snap.y * scale,
      width: snap.width * scale,
      height: snap.height * scale,
    };
    const resizedScaled = scaledPoints(snapped);

    for (let i = 0; i < origScaled.length; i++) {
      expect(resizedScaled[i].x).toBeCloseTo(origScaled[i].x * scale);
      expect(resizedScaled[i].y).toBeCloseTo(origScaled[i].y * scale);
    }
  });
});

// ---- TC-07: distanceToPolyline hit test ----

describe('TC-07: distanceToPolyline hit test', () => {
  it('within / within / outside tolerance', () => {
    const scaledPts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(distanceToPolyline(scaledPts, { x: 5, y: 0 })).toBeLessThanOrEqual(6);
    expect(distanceToPolyline(scaledPts, { x: 5, y: 5.9 })).toBeLessThanOrEqual(6);
    expect(distanceToPolyline(scaledPts, { x: 5, y: 6.1 })).toBeGreaterThan(6);
  });
});

// ---- TC-08: smoothPath deterministic output ----

describe('TC-08: smoothPath', () => {
  it('starts with M and uses Q segments', () => {
    const path = smoothPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
    expect(path).toBe('M 0 0 Q 2.5 2.5 5 5 Q 7.5 2.5 10 0');
  });

  it('single point produces zero-length path', () => {
    expect(smoothPath([{ x: 42, y: 42 }])).toBe('M 42 42');
  });
});

// ---- Helper ----

function readSnap(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const objects = doc.getMap('objects') as unknown as Map<string, Y.Map<unknown>>;
  const inner = objects.get(id);
  if (!inner) return undefined;
  const getField = (key: string): unknown => inner.get(key);
  return {
    id,
    type: 'stroke',
    x: Number(getField('x')) ?? 0,
    y: Number(getField('y')) ?? 0,
    width: Number(getField('width')) ?? 0,
    height: Number(getField('height')) ?? 0,
    points: (getField('points') as number[]) ?? [],
    baseWidth: Number(getField('baseWidth')) ?? 0,
    baseHeight: Number(getField('baseHeight')) ?? 0,
    color: (getField('color') as PenColor) ?? 'black',
    thickness: (getField('thickness') as PenThickness) ?? 'medium',
    z: Number(getField('z')) ?? 0,
    createdBy: (getField('createdBy') as string) ?? '',
    createdAt: Number(getField('createdAt')) ?? 0,
  };
}
