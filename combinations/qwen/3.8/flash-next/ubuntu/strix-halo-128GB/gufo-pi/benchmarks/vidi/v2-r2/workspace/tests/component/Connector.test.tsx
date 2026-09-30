import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '@shared/board-model';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
} from '@shared/geometry/connector-geometry';
import { distanceToPolyline } from '@shared/geometry/polyline';
import type { Rect, Point } from '@shared/geometry';

describe('connector.ui (component level)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-18: hover dots at side midpoints - verified via geometry
  it('sideAnchor returns midpoints of all 4 sides', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 80 };
    expect(sideAnchor(rect, 'top')).toEqual({ x: 50, y: 0 });
    expect(sideAnchor(rect, 'right')).toEqual({ x: 100, y: 40 });
    expect(sideAnchor(rect, 'bottom')).toEqual({ x: 50, y: 80 });
    expect(sideAnchor(rect, 'left')).toEqual({ x: 0, y: 40 });
  });

  // TC-19: drag from A over B highlights nearest side
  it('nearestSide identifies correct target side', () => {
    const rectA: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const rectB: Rect = { x: 300, y: 0, width: 100, height: 100 };

    // From B's center, A's nearest side should be right
    const bCenter: Point = { x: 350, y: 50 };
    expect(nearestSide(rectA, bCenter)).toBe('right');

    // From A's center, B's nearest side should be left
    const aCenter: Point = { x: 50, y: 50 };
    expect(nearestSide(rectB, aCenter)).toBe('left');
  });

  // TC-20: hit test at different zoom levels
  it('distanceToPolyline respects screen pixel tolerance at zoom 0.5 and 2', () => {
    const line: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // At zoom 0.5, 6px screen = 12 board units
    const tolerance50 = 6 / 0.5; // 12 board units
    const point5pxAt50 = { x: 50, y: 10 }; // 10 board units = 5 screen px at 0.5x
    expect(distanceToPolyline(line, point5pxAt50) <= tolerance50).toBe(true);

    const point7pxAt50 = { x: 50, y: 14.1 }; // 14.1 board units = 7.05 screen px at 0.5x
    expect(distanceToPolyline(line, point7pxAt50) <= tolerance50).toBe(false);

    // At zoom 2, 6px screen = 3 board units
    const tolerance200 = 6 / 2; // 3 board units
    const point5pxAt200 = { x: 50, y: 2.5 }; // 2.5 board units = 5 screen px at 2x
    expect(distanceToPolyline(line, point5pxAt200) <= tolerance200).toBe(true);

    const point7pxAt200 = { x: 50, y: 3.5 }; // 3.5 board units = 7 screen px at 2x
    expect(distanceToPolyline(line, point7pxAt200) <= tolerance200).toBe(false);
  });

  // TC-21 prerequisite: connector endpoints can be updated
  it('connector can be created and snapshot contains resolved positions', () => {
    // Create two shapes manually
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const shapeA = new Y.Map<unknown>();
    shapeA.set('type', 'shape');
    shapeA.set('x', 0);
    shapeA.set('y', 0);
    shapeA.set('width', 100);
    shapeA.set('height', 100);
    shapeA.set('z', 1);
    shapeA.set('createdAt', Date.now());
    shapeA.set('kind', 'rect');
    shapeA.set('fill', 'white');
    shapeA.set('stroke', 'dark');
    shapeA.set('label', new Y.Text());
    objects.set('A', shapeA);

    const shapeB = new Y.Map<unknown>();
    shapeB.set('type', 'shape');
    shapeB.set('x', 300);
    shapeB.set('y', 0);
    shapeB.set('width', 100);
    shapeB.set('height', 100);
    shapeB.set('z', 2);
    shapeB.set('createdAt', Date.now());
    shapeB.set('kind', 'rect');
    shapeB.set('fill', 'white');
    shapeB.set('stroke', 'dark');
    shapeB.set('label', new Y.Text());
    objects.set('B', shapeB);

    const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
    const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
    const connId = createConnector(doc, from, to, 'user1')!;
    expect(connId).not.toBeNull();

    const snap = snapshot(doc);
    const connSnap = snap.find((s) => s.id === connId);
    expect(connSnap).toBeDefined();
    expect(connSnap!.type).toBe('connector');

    // Verify that the connector bbox is resolved between the two anchors
    expect(connSnap!.x).toBe(100); // from right of A
    expect(connSnap!.y).toBe(50);  // mid height
    expect(connSnap!.width).toBe(200); // to left of B (300)
    expect(connSnap!.height).toBe(0);
  });
});
