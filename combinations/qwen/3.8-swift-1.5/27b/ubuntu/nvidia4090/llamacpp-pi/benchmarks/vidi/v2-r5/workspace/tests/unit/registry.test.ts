// tests/unit/registry.test.ts
// TC-11, TC-12: object type registry

import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType, _resetRegistry } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

// Import the sticky registration (side effect: registers 'sticky')
import '../../src/client/objects/registerSticky';

describe('sel.registry (unit)', () => {
  // TC-11: getObjectType('sticky') → correct spec
  describe('TC-11: sticky type spec', () => {
    it('has correct properties', () => {
      const spec = getObjectType('sticky');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(true);
      expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
      expect(spec!.editableText).toBe(true);
    });

    it('hitTest is true inside bounds', () => {
      const spec = getObjectType('sticky')!;
      const obj: ObjectSnapshot = { id: 'test', type: 'sticky', x: 0, y: 0, z: 0 };
      // STICKY_SIZE_WORLD = 200, so bounds are 0,0 to 200,200
      expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
      expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
      expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true);
    });

    it('hitTest is false 1 unit outside', () => {
      const spec = getObjectType('sticky')!;
      const obj: ObjectSnapshot = { id: 'test', type: 'sticky', x: 0, y: 0, z: 0 };
      expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false);
      expect(spec.hitTest(obj, { x: 100, y: 201 })).toBe(false);
      expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
    });
  });

  // TC-12: getObjectType('unknown') → undefined
  describe('TC-12: unknown type', () => {
    it('returns undefined for unregistered type', () => {
      expect(getObjectType('unknown')).toBeUndefined();
      expect(getObjectType('shape')).toBeUndefined();
    });
  });

  // Duplicate registration throws
  describe('duplicate registration', () => {
    it('throws on duplicate registration', () => {
      expect(() => {
        registerObjectType('sticky', {
          Component: () => null,
          resizable: true,
          aspectLocked: true,
          minSize: 50,
          editableText: true,
          hitTest: () => false,
        });
      }).toThrow(/Duplicate registration/);
    });
  });

  // Test-only testbox type
  describe('testbox type (test-only)', () => {
    it('can be registered and retrieved', () => {
      // Register a test-only type
      registerObjectType('testbox', {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: () => false,
      });

      const spec = getObjectType('testbox');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(false);
      expect(spec!.minSize).toBe(10);
    });
  });
});
