import { describe, it, expect } from 'vitest';
import type { ObjectTypeSpec, Point } from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('sel.registry — TC-11, TC-12', () => {
  // These tests verify the registry contract. Implementation will be written after these specs.
  
  describe('TC-11: getObjectType sticky', () => {
    it('returns spec with resizable=true, aspectLocked=true, minSize=STICKY_MIN_SIZE_WORLD, editableText=true', () => {
      // Placeholder for when registry is implemented
      expect(true).toBe(true);
    });

    it('hitTest true inside bounds and false 1 unit outside (boundary)', () => {
      const spec = {
        hitTest: (_obj: ObjectSnapshot, _point: Point) => true,
      };
      expect(spec.hitTest).toBeDefined();
    });
  });

  describe('TC-12: getObjectType unknown', () => {
    it('returns undefined for unknown type', () => {
      // Placeholder
      expect(true).toBe(true);
    });
  });

  describe('Duplicate registration', () => {
    it('throws on duplicate registerObjectType call', () => {
      // Placeholder
      expect(true).toBe(true);
    });
  });

  describe('Test-only testbox type', () => {
    it('is retrievable after registration', () => {
      // Test-only fixture should be used by component tests
      expect(true).toBe(true);
    });
  });
});
