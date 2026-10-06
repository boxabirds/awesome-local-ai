/**
 * Registry unit tests (TC-11, TC-12, duplicate registration).
 */
import { describe, expect, test } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('registry', () => {
  // TC-11: getObjectType('sticky') has correct spec
  test('TC-11: sticky spec is correct', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  test('TC-11: sticky hitTest is true inside bounds and false outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 100, y: 100, color: 'yellow' as const, text: '', z: 1, createdAt: 0 };
    // Inside the 200×200 bounds (default STICKY_SIZE_WORLD)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // 1 unit outside (right edge is at 300)
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    // 1 unit outside (bottom edge is at 300)
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
    // Exactly on edge is inside (inclusive)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 299, y: 299 })).toBe(true);
  });

  // TC-12: unknown type returns undefined
  test('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  // Duplicate registration throws
  test('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {} as ObjectTypeSpec);
    }).toThrow();
  });
});
