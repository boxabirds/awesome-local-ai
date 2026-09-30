import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, deleteObjects } from '@shared/board-model';
import { createConnector, setConnectorEndpoint, type Endpoint } from '@shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  resolveEndpoints,
  connectorBBox,
} from '@shared/geometry/connector-geometry';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { CONNECTOR_MIN_LENGTH_WORLD } from '@shared/config';
import type { Rect, Point } from '@shared/geometry';

describe('connector.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-07: attached A→B 300 apart → stored endpoints with fallbacks = side anchors; 1 update
  describe('TC-07: create attached connector', () => {
    it('stores attached endpoints with fallbacks and 1 update', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 200, y: 100 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 500, y: 100 } };

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createConnector(doc, from, to, 'user1');
      expect(id).not.toBeNull();
      expect(updateCount).toBe(1);

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('type')).toBe('connector');
      const fromMap = obj.get('from') as Y.Map<unknown>;
      expect(fromMap.get('kind')).toBe('attached');
      expect(fromMap.get('objectId')).toBe('A');
      const toMap = obj.get('to') as Y.Map<unknown>;
      expect(toMap.get('kind')).toBe('attached');
      expect(toMap.get('objectId')).toBe('B');
    });
  });

  // TC-08: A→A → null, 0 updates (negative)
  describe('TC-08: self-connection rejected', () => {
    it('returns null and 0 updates for same object', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 100 } };
      const to: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 200, y: 200 } };

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createConnector(doc, from, to, 'user1');
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });
  });

  // TC-09: free→free length 7.9 → null; length 8 → created
  describe('TC-09: minimum length boundary', () => {
    it('rejects length below CONNECTOR_MIN_LENGTH_WORLD', () => {
      const from: Endpoint = { kind: 'free', x: 0, y: 0 };
      const to: Endpoint = { kind: 'free', x: 7.9, y: 0 };

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createConnector(doc, from, to, 'user1');
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('accepts length equal to CONNECTOR_MIN_LENGTH_WORLD', () => {
      const from: Endpoint = { kind: 'free', x: 0, y: 0 };
      const to: Endpoint = { kind: 'free', x: CONNECTOR_MIN_LENGTH_WORLD, y: 0 };

      const id = createConnector(doc, from, to, 'user1');
      expect(id).not.toBeNull();
    });
  });

  // TC-10: nearestSide as B orbits A at 0°, 44°, 46°, 90°
  describe('TC-10: nearestSide orbit', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };

    it('returns right at 0 degrees', () => {
      const toward = { x: 300, y: 50 }; // directly right of center
      expect(nearestSide(rect, toward)).toBe('right');
    });

    it('returns right at 44 degrees', () => {
      // 44 degrees from horizontal right: dx > dy
      const angle = (44 * Math.PI) / 180;
      const cx = 50, cy = 50;
      const toward = { x: cx + 200 * Math.cos(angle), y: cy - 200 * Math.sin(angle) };
      expect(nearestSide(rect, toward)).toBe('right');
    });

    it('returns top at 46 degrees', () => {
      // 46 degrees from horizontal: dy > dx
      const angle = (46 * Math.PI) / 180;
      const cx = 50, cy = 50;
      const toward = { x: cx + 200 * Math.cos(angle), y: cy - 200 * Math.sin(angle) };
      expect(nearestSide(rect, toward)).toBe('top');
    });

    it('returns top at 90 degrees', () => {
      const toward = { x: 50, y: -100 }; // directly above center
      expect(nearestSide(rect, toward)).toBe('top');
    });
  });

  // TC-11: resolveEndpoints with B missing from rects → end at fallback, no throw
  describe('TC-11: orphaned endpoint renders at fallback', () => {
    it('uses fallback when target rect is missing', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
      const rects = new Map<string, Rect>();
      rects.set('A', { x: 0, y: 0, width: 100, height: 100 });
      // B is missing from rects

      const result = resolveEndpoints({ from, to }, rects);
      expect(result.to).toEqual({ x: 300, y: 50 }); // fallback
      expect(result.from).toBeDefined();
    });
  });

  // TC-12: setConnectorEndpoint to free → updated; to attached C → updated; to opposite object → false, 0 updates
  describe('TC-12: setConnectorEndpoint', () => {
    it('re-attaches to free', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
      const id = createConnector(doc, from, to, 'user1')!;

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const result = setConnectorEndpoint(doc, id, 'to', { kind: 'free', x: 400, y: 200 });
      expect(result).toBe(true);
      expect(updateCount).toBe(1);
    });

    it('re-attaches to another object', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
      const id = createConnector(doc, from, to, 'user1')!;

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const result = setConnectorEndpoint(doc, id, 'to', { kind: 'attached', objectId: 'C', fallback: { x: 500, y: 100 } });
      expect(result).toBe(true);
      expect(updateCount).toBe(1);
    });

    it('rejects attaching to opposite end object', () => {
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
      const id = createConnector(doc, from, to, 'user1')!;

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      // Try to attach 'from' to 'B' (opposite end object)
      const result = setConnectorEndpoint(doc, id, 'from', { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } });
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });
  });

  // TC-13: deleteObjects([A]) with connector attached to A → A removed, connector 'from' becomes free at anchor, exactly one update
  describe('TC-13: delete connected object', () => {
    it('detaches connector and removes object in one update', () => {
      // Create a shape A and B
      const objects = doc.getMap<Y.Map<unknown>>('objects');

      // Manually create shape A
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

      // Manually create shape B
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

      // Create connector from A to B
      const from: Endpoint = { kind: 'attached', objectId: 'A', fallback: { x: 100, y: 50 } };
      const to: Endpoint = { kind: 'attached', objectId: 'B', fallback: { x: 300, y: 50 } };
      const connId = createConnector(doc, from, to, 'user1')!;

      // Now delete A - should be exactly 1 update
      let updateCount = 0;
      doc.on('update', () => updateCount++);

      deleteObjects(doc, ['A']);
      expect(updateCount).toBe(1);

      // A is removed
      expect(objects.has('A')).toBe(false);

      // Connector still exists, 'from' is now free
      const conn = objects.get(connId)!;
      const fromMap = conn.get('from') as Y.Map<unknown>;
      expect(fromMap.get('kind')).toBe('free');
      // The free point should be at A's right anchor (since B is to the right)
      expect(fromMap.get('x')).toBe(100); // right side of A (x=0, width=100)
      expect(fromMap.get('y')).toBe(50);  // midpoint of height
    });
  });

  // TC-14: distanceToPolyline at 0, 5.99, 6.01 units from a segment
  describe('TC-14: distanceToPolyline', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    it('returns 0 for point on line', () => {
      expect(distanceToPolyline(pts, { x: 50, y: 0 })).toBeCloseTo(0);
    });

    it('returns 5.99 for point 5.99 units away', () => {
      expect(distanceToPolyline(pts, { x: 50, y: 5.99 })).toBeCloseTo(5.99);
    });

    it('returns 6.01 for point 6.01 units away', () => {
      expect(distanceToPolyline(pts, { x: 50, y: 6.01 })).toBeCloseTo(6.01);
    });
  });

  // TC-29: setConnectorEndpoint on deleted connector id → false (stale id)
  describe('TC-29: stale connector id', () => {
    it('returns false for deleted connector', () => {
      const from: Endpoint = { kind: 'free', x: 0, y: 0 };
      const to: Endpoint = { kind: 'free', x: 100, y: 0 };
      const id = createConnector(doc, from, to, 'user1')!;

      // Delete it directly
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      objects.delete(id);

      const result = setConnectorEndpoint(doc, id, 'from', { kind: 'free', x: 50, y: 50 });
      expect(result).toBe(false);
    });
  });

  // Additional geometry tests
  describe('sideAnchor', () => {
    const r: Rect = { x: 10, y: 20, width: 100, height: 60 };

    it('top midpoint', () => {
      expect(sideAnchor(r, 'top')).toEqual({ x: 60, y: 20 });
    });
    it('right midpoint', () => {
      expect(sideAnchor(r, 'right')).toEqual({ x: 110, y: 50 });
    });
    it('bottom midpoint', () => {
      expect(sideAnchor(r, 'bottom')).toEqual({ x: 60, y: 80 });
    });
    it('left midpoint', () => {
      expect(sideAnchor(r, 'left')).toEqual({ x: 10, y: 50 });
    });
  });

  describe('connectorBBox', () => {
    it('computes bounding box', () => {
      const bbox = connectorBBox({ x: 10, y: 20 }, { x: 110, y: 80 });
      expect(bbox).toEqual({ x: 10, y: 20, width: 100, height: 60 });
    });

    it('handles reversed points', () => {
      const bbox = connectorBBox({ x: 110, y: 80 }, { x: 10, y: 20 });
      expect(bbox).toEqual({ x: 10, y: 20, width: 100, height: 60 });
    });
  });
});
