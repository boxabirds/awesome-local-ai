import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { StrokeObject } from '@client/objects/StrokeObject';
import { createStroke, type StrokeSnap } from '@shared/objects/stroke';
import { initDoc } from '@shared/board-model';
import {
  registerStrokeType,
  getObjectType,
  _resetRegistryForTesting,
} from '@client/objects/registry';
import type { Point } from '@shared/geometry';

describe('StrokeObject', () => {
  // TC-15: registry hitTest at 5px and 7px screen distance at 50% and 200% zoom
  describe('TC-15 hit test by line distance', () => {
    // Ensure stroke type is registered for these tests
    _resetRegistryForTesting();
    registerStrokeType(StrokeObject as any);
    function createHorizontalStroke(doc: Y.Doc): { id: string; snap: StrokeSnap } {
      // Horizontal line from (100, 100) to (200, 100)
      const pts: Point[] = [
        { x: 100, y: 100 },
        { x: 150, y: 100 },
        { x: 200, y: 100 },
      ];
      const id = createStroke(doc, { points: pts, color: 'black', thickness: 'thin' }, 'test')!;
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
      const snap: StrokeSnap = {
        id,
        type: 'stroke',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: 1,
        createdAt: Date.now(),
        createdBy: 'test',
        points: obj.get('points') as readonly number[],
        baseWidth: obj.get('baseWidth') as number,
        baseHeight: obj.get('baseHeight') as number,
        color: 'black',
        thickness: 'thin',
      };
      return { id, snap };
    }

    it('hit at 5px screen distance at 50% zoom', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const { snap } = createHorizontalStroke(doc);
      const spec = getObjectType('stroke')!;
      expect(spec).toBeDefined();

      // At 50% zoom, 5px screen = 10px world
      // The hit tolerance is max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)
      // For thin (2): max(1, 6/0.5) = max(1, 12) = 12
      // A point 5px screen away at 50% zoom = 10px world: should hit (10 < 12)
      const worldDist = 5 / 0.5; // 10 world units
      const clickPoint = { x: 150, y: 100 + worldDist };
      expect(spec.hitTest(snap as any, clickPoint, 0.5)).toBe(true);
    });

    it('miss at 7px screen distance at 50% zoom', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const { snap } = createHorizontalStroke(doc);
      const spec = getObjectType('stroke')!;

      // At 50% zoom, 7px screen = 14px world. Tolerance = max(1, 12) = 12. 14 > 12 = miss
      const worldDist = 7 / 0.5; // 14 world units
      const clickPoint = { x: 150, y: 100 + worldDist };
      expect(spec.hitTest(snap as any, clickPoint, 0.5)).toBe(false);
    });

    it('hit at 5px screen distance at 200% zoom', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const { snap } = createHorizontalStroke(doc);
      const spec = getObjectType('stroke')!;

      // At 200% zoom, 5px screen = 2.5px world. Tolerance = max(1, 6/2) = max(1, 3) = 3. 2.5 < 3 = hit
      const worldDist = 5 / 2; // 2.5 world units
      const clickPoint = { x: 150, y: 100 + worldDist };
      expect(spec.hitTest(snap as any, clickPoint, 2)).toBe(true);
    });

    it('miss at 7px screen distance at 200% zoom', () => {
      const doc = new Y.Doc();
      initDoc(doc);
      const { snap } = createHorizontalStroke(doc);
      const spec = getObjectType('stroke')!;

      // At 200% zoom, 7px screen = 3.5px world. Tolerance = max(1, 3) = 3. 3.5 > 3 = miss
      const worldDist = 7 / 2; // 3.5 world units
      const clickPoint = { x: 150, y: 100 + worldDist };
      expect(spec.hitTest(snap as any, clickPoint, 2)).toBe(false);
    });
  });

  // TC-16: click inside bbox far from line → not hit (falls through)
  describe('TC-16 click far from line does not select stroke', () => {
    it('hit test returns false for point inside bbox but far from line', () => {
      const doc = new Y.Doc();
      initDoc(doc);

      // Create a large arc-like stroke so the bbox is big but the line is thin
      const pts: Point[] = [];
      for (let i = 0; i < 50; i++) {
        const t = (i / 49) * Math.PI; // half circle
        pts.push({ x: 200 + Math.cos(t) * 100, y: 200 + Math.sin(t) * 100 });
      }
      const id = createStroke(doc, { points: pts, color: 'black', thickness: 'thin' }, 'test')!;
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
      const snap: StrokeSnap = {
        id,
        type: 'stroke',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: 1,
        createdAt: Date.now(),
        createdBy: 'test',
        points: obj.get('points') as readonly number[],
        baseWidth: obj.get('baseWidth') as number,
        baseHeight: obj.get('baseHeight') as number,
        color: 'black',
        thickness: 'thin',
      };

      _resetRegistryForTesting();
      registerStrokeType(StrokeObject as any);
      const spec = getObjectType('stroke')!;

      // Point at center of the bbox, far from the arc line
      const centerPoint = { x: 200, y: 200 };
      // The arc is at radius 100 from center, so center is 100 units from the line
      expect(spec.hitTest(snap as any, centerPoint)).toBe(false);
    });
  });

  // TC-21: stroke deleted while selected → no exception
  describe('TC-21 remote delete while selected', () => {
    it('does not throw when stroke object is missing', () => {
      const doc = new Y.Doc();
      initDoc(doc);

      const id = createStroke(doc, {
        points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        color: 'black',
        thickness: 'medium',
      }, 'test')!;

      // Delete the stroke (simulating remote deletion)
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      doc.transact(() => objects.delete(id));

      // Rendering a StrokeObject with missing data should not throw
      // In practice, the parent (StrokeLayer) filters by type from snapshot,
      // so the component won't receive a snap for a deleted stroke.
      // We just verify the component doesn't throw on edge-case data.
      const snap: StrokeSnap = {
        id,
        type: 'stroke',
        x: 0, y: 0, width: 4, height: 4,
        z: 1, createdAt: 0, createdBy: '',
        points: [2, 2, 12, 12],
        baseWidth: 10, baseHeight: 10,
        color: 'black', thickness: 'medium',
      };

      expect(() => {
        render(<StrokeObject stroke={snap} selected={true} zoom={1} />);
      }).not.toThrow();
    });
  });

  // Additional: StrokeObject renders with aria-label="Drawing"
  describe('rendering', () => {
    it('renders with aria-label "Drawing"', () => {
      const snap: StrokeSnap = {
        id: 'test-1',
        type: 'stroke',
        x: 0, y: 0, width: 100, height: 100,
        z: 1, createdAt: 0, createdBy: '',
        points: [4, 4, 96, 96],
        baseWidth: 100, baseHeight: 100,
        color: 'black', thickness: 'medium',
      };

      render(<StrokeObject stroke={snap} selected={false} zoom={1} />);
      expect(screen.getByLabelText('Drawing')).toBeDefined();
    });
  });
});
