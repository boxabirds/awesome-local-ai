import { describe, expect, it, beforeEach } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('object type registry', () => {
  // TC-11: getObjectType('sticky') returns correct spec with hitTest
  describe('TC-11 sticky type registration', () => {
    it('getObjectType("sticky") returns correct spec fields', () => {
      const spec = getObjectType('sticky');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(true);
      expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
      expect(spec!.editableText).toBe(true);
    });

    it('hitTest is true for a point inside bounds', () => {
      const spec = getObjectType('sticky')!;
      const obj: ObjectSnapshot = {
        id: 'test',
        type: 'sticky',
        x: 100,
        y: 100,
        color: 'yellow',
        text: '',
        z: 1,
        createdAt: 0,
      };
      // STICKY_SIZE_WORLD is 200, so bounds are (100,100) to (300,300)
      expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
      expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true);
      // Exactly at boundary is inside
      expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
      expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
    });

    it('hitTest is false for a point 1 unit outside bounds', () => {
      const spec = getObjectType('sticky')!;
      const obj: ObjectSnapshot = {
        id: 'test',
        type: 'sticky',
        x: 100,
        y: 100,
        color: 'yellow',
        text: '',
        z: 1,
        createdAt: 0,
      };
      expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
      expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
      expect(spec.hitTest(obj, { x: 150, y: 99 })).toBe(false);
      expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
    });

    it('hitTest respects explicit width/height', () => {
      const spec = getObjectType('sticky')!;
      const obj: ObjectSnapshot = {
        id: 'test',
        type: 'sticky',
        x: 100,
        y: 100,
        color: 'yellow',
        text: '',
        z: 1,
        createdAt: 0,
        width: 500,
        height: 400,
      };
      // Bounds are (100,100) to (600,500)
      expect(spec.hitTest(obj, { x: 599, y: 499 })).toBe(true);
      expect(spec.hitTest(obj, { x: 601, y: 150 })).toBe(false);
    });
  });

  // TC-12: getObjectType('unknown') → undefined
  describe('TC-12 unknown type', () => {
    it('returns undefined for unregistered type', () => {
      expect(getObjectType('unknown')).toBeUndefined();
    });
  });

  // Duplicate registration throws
  describe('duplicate registration', () => {
    it('throws when registering the same type twice', () => {
      // 'sticky' is already registered at import time
      expect(() => registerObjectType('sticky', {} as ObjectTypeSpec)).toThrow();
    });
  });

  // Test-only type registration
  describe('testbox type registration', () => {
    it('can register and retrieve a test-only resizable non-locked type', () => {
      const dummyComponent = () => null;
      registerObjectType('testbox', {
        Component: dummyComponent,
        resizable: true,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: (obj, pt) => {
          const w = obj.width ?? 200;
          const h = obj.height ?? 200;
          return pt.x >= obj.x && pt.x <= obj.x + w && pt.y >= obj.y && pt.y <= obj.y + h;
        },
      });
      const spec = getObjectType('testbox');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(false);
      expect(spec!.minSize).toBe(10);
      expect(spec!.editableText).toBe(false);
    });
  });
});
