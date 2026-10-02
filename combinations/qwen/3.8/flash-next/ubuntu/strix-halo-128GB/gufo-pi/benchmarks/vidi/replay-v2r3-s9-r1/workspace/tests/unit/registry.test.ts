import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('object type registry', () => {
  it('TC-11: getObjectType("sticky") has correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds, false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 100, y: 100, width: 200, height: 200, color: 'yellow' as const, text: '', z: 1, createdAt: 0 };

    // Inside bounds (100,100) - (300,300)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // On the boundary
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
    // 1 unit outside
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 99 })).toBe(false);
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
  });

  it('TC-12: getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() => registerObjectType('sticky', {
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => false,
    })).toThrow();
  });

  it('can register a test-only type and retrieve it', () => {
    // Register a non-aspect-locked test type (used by component tests)
    registerObjectType('testbox', {
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    });
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
