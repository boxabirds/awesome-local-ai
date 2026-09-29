import { describe, it, expect } from 'vitest';
import { registerObjectType, getObjectType, registerStickyType, ObjectTypeSpec } from '@client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';
import { ObjectSnapshot } from '@shared/board-model';

// Register the sticky type for testing (in the real app, this is done by Board.tsx)
let registered = false;
function ensureStickyRegistered() {
  if (!registered) {
    registerStickyType(() => null);
    registered = true;
  }
}

describe('registry', () => {
  describe('TC-11: getObjectType("sticky")', () => {
    it('has correct spec', () => {
      ensureStickyRegistered();
      const spec = getObjectType('sticky');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(true);
      expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
      expect(spec!.editableText).toBe(true);
    });

    it('hitTest returns true inside bounds and false 1 unit outside', () => {
      ensureStickyRegistered();
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
      // Default size is STICKY_SIZE_WORLD = 200
      // Bounds: (100, 100) to (300, 300)
      expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true);
      expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
      expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
      // 1 unit outside
      expect(spec.hitTest(obj, { x: 99, y: 200 })).toBe(false);
      expect(spec.hitTest(obj, { x: 301, y: 200 })).toBe(false);
      expect(spec.hitTest(obj, { x: 200, y: 99 })).toBe(false);
      expect(spec.hitTest(obj, { x: 200, y: 301 })).toBe(false);
    });
  });

  describe('TC-12: getObjectType("unknown")', () => {
    it('returns undefined for unregistered type', () => {
      expect(getObjectType('unknown_type_xyz')).toBeUndefined();
    });
  });

  describe('duplicate registration throws', () => {
    it('registerObjectType with duplicate type throws', () => {
      ensureStickyRegistered();
      expect(() => {
        registerObjectType('sticky', {
          Component: () => null,
          resizable: false,
          aspectLocked: false,
          minSize: 10,
          editableText: false,
          hitTest: () => false,
        });
      }).toThrow();
    });
  });

  describe('testbox type registration', () => {
    it('registers a test-only resizable, non-locked type with minSize 10', () => {
      const testboxSpec: ObjectTypeSpec = {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: (obj, point) => {
          const w = (obj as any).width ?? 200;
          const h = (obj as any).height ?? 200;
          return point.x >= obj.x && point.x <= obj.x + w &&
                 point.y >= obj.y && point.y <= obj.y + h;
        },
      };
      registerObjectType('testbox', testboxSpec);
      const spec = getObjectType('testbox');
      expect(spec).toBeDefined();
      expect(spec!.resizable).toBe(true);
      expect(spec!.aspectLocked).toBe(false);
      expect(spec!.minSize).toBe(10);
    });
  });
});
