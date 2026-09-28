import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('object type registry', () => {
  // TC-11: sticky spec has correct properties
  it('TC-11 getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  // TC-11 boundary: hitTest true inside bounds, false 1 unit outside
  it('TC-11 sticky hitTest returns true inside bounds, false outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = {
      id: 'test',
      type: 'sticky' as const,
      x: 0,
      y: 0,
      color: 'yellow' as const,
      text: '',
      z: 1,
      createdAt: 1000,
    };

    // Center of a 200x200 sticky at (0,0) → hit
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // Top-left corner → hit (on boundary)
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    // Bottom-right corner → hit (on boundary)
    expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true);
    // 1 unit outside right edge → miss
    expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    // 1 unit outside top edge → miss
    expect(spec.hitTest(obj, { x: 100, y: -1 })).toBe(false);
  });

  // TC-11 with explicit width/height
  it('TC-11 sticky hitTest with explicit width/height', () => {
    const spec = getObjectType('sticky')!;
    const obj = {
      id: 'test2',
      type: 'sticky' as const,
      x: 10,
      y: 10,
      width: 300,
      height: 300,
      color: 'yellow' as const,
      text: '',
      z: 1,
      createdAt: 1000,
    };
    expect(spec.hitTest(obj, { x: 160, y: 160 })).toBe(true);
    expect(spec.hitTest(obj, { x: 311, y: 160 })).toBe(false);
  });

  // TC-12: unknown type returns undefined
  it('TC-12 getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  // Duplicate registration throws
  it('duplicate registerObjectType throws', () => {
    expect(() => registerObjectType('sticky', {} as ObjectTypeSpec)).toThrow();
  });
});
