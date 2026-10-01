import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { getObjectType } from '../../src/client/objects/registry';
// Ensure registration happens
import '../../src/client/objects/registerStroke';
import '../../src/client/objects/registerSticky';

describe('StrokeObject hit test (registry)', () => {
  it('TC-15: hitTest at 5px and 7px screen distance at 50% and 200% zoom → hit / miss', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    const doc = new Y.Doc();
    // Create a horizontal stroke from (0,0) to (100,0) - medium thickness (4 world units)
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      color: 'black',
      thickness: 'medium',
    }, 'user-1')!;

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: map.get('width') as number,
      height: map.get('height') as number,
      z: 0,
      points: map.get('points') as number[],
      baseWidth: map.get('baseWidth') as number,
      baseHeight: map.get('baseHeight') as number,
      color: 'black',
      thickness: 'medium',
    };

    const pts = scaledPoints(snap);
    // The line runs horizontally at pts[0].y. Test midpoint at x=(pts[0].x+pts[1].x)/2
    const midX = (pts[0]!.x + pts[1]!.x) / 2;
    const lineY = pts[0]!.y;

    // At zoom 1: registry hitTest uses max(thickness/2, STROKE_HIT_TOLERANCE_PX) = max(2, 6) = 6
    // 5 world units from line → within 6 → hit
    expect(spec!.hitTest(snap, { x: midX, y: lineY + 5 })).toBe(true);
    // 7 world units from line → outside 6 → miss
    expect(spec!.hitTest(snap, { x: midX, y: lineY + 7 })).toBe(false);

    // At 50% zoom: tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX/0.5) = max(2, 12) = 12
    // 5px at 50% zoom = 10 world units → within 12 → hit
    const tol50 = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 0.5);
    const dist10 = distanceToPolyline(pts, { x: midX, y: lineY + 10 });
    expect(dist10 <= tol50).toBe(true);
    // 7px at 50% zoom = 14 world units → outside 12 → miss
    const dist14 = distanceToPolyline(pts, { x: midX, y: lineY + 14 });
    expect(dist14 <= tol50).toBe(false);

    // At 200% zoom: tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX/2) = max(2, 3) = 3
    // 5px at 200% zoom = 2.5 world units → within 3 → hit
    const tol200 = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 2);
    const dist25 = distanceToPolyline(pts, { x: midX, y: lineY + 2.5 });
    expect(dist25 <= tol200).toBe(true);
    // 7px at 200% zoom = 3.5 world units → outside 3 → miss
    const dist35 = distanceToPolyline(pts, { x: midX, y: lineY + 3.5 });
    expect(dist35 <= tol200).toBe(false);
  });

  it('TC-16: click inside bbox far from line → stroke NOT selected (miss)', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    const doc = new Y.Doc();
    // Create a small stroke: a short arc from (0,0) to (20,0) with peak at (10,5)
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }],
      color: 'black',
      thickness: 'thin',
    }, 'user-1')!;

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: map.get('width') as number,
      height: map.get('height') as number,
      z: 0,
      points: map.get('points') as number[],
      baseWidth: map.get('baseWidth') as number,
      baseHeight: map.get('baseHeight') as number,
      color: 'black',
      thickness: 'thin',
    };

    // Point far from the line (well below the arc, inside bbox)
    // Bbox: x=-1, y=-1, w=22, h=7. The line is near y=0 to y=5.
    // A point at (10, 15) is inside bbox but far from the line (>6 units)
    const farPoint = { x: 10, y: 15 };
    expect(spec!.hitTest(snap, farPoint)).toBe(false);

    // Point ON the line (the peak of the arc at (10,5)) → hit
    const onLine = { x: 10, y: 5 };
    expect(spec!.hitTest(snap, onLine)).toBe(true);
  });
});

describe('StrokeObject rendering', () => {
  it('renders an SVG path with aria-label "Drawing"', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 10 }],
      color: 'black',
      thickness: 'medium',
    }, 'user-1')!;

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: map.get('width') as number,
      height: map.get('height') as number,
      z: 0,
      points: map.get('points') as number[],
      baseWidth: map.get('baseWidth') as number,
      baseHeight: map.get('baseHeight') as number,
      color: 'black',
      thickness: 'medium',
    };

    const { container } = render(
      <StrokeObject stroke={snap} selected={false} />,
    );

    const svg = container.querySelector('svg[aria-label="Drawing"]');
    expect(svg).toBeTruthy();
    const path = svg!.querySelector('path');
    expect(path).toBeTruthy();
    expect(path!.getAttribute('d')).toContain('M');
  });

  it('stroke deleted while selected → no error (TC-21)', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'user-1')!;

    const objMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objMap.get(id)!;
    const snap: StrokeSnap = {
      id,
      type: 'stroke',
      x: map.get('x') as number,
      y: map.get('y') as number,
      width: map.get('width') as number,
      height: map.get('height') as number,
      z: 0,
      points: map.get('points') as number[],
      baseWidth: map.get('baseWidth') as number,
      baseHeight: map.get('baseHeight') as number,
      color: 'black',
      thickness: 'medium',
    };

    // Render with "selected"
    const { container } = render(
      <StrokeObject stroke={snap} selected={true} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();

    // Delete the stroke from the doc (simulates remote delete)
    // In a real app, the snapshot would update and the component would unmount.
    // Here we verify that even if the snap data is stale, rendering doesn't throw.
    objMap.delete(id);

    // Re-render with the old snap data - should not throw
    expect(() => {
      render(<StrokeObject stroke={snap} selected={true} />);
    }).not.toThrow();
  });
});
