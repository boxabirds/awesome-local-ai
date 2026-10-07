import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('registry', () => {
  // TC-11: getObjectType('sticky') returns expected spec
  it('TC-11: sticky spec has correct properties', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = { id: 'test', type: 'sticky', x: 100, y: 100, z: 1, width: 200, height: 200 };
    // Inside: point (150, 150) is within (100,100)-(300,300)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // Boundary: point on edge (100, 100) should be inside
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // Outside: point (99, 99) is just outside top-left
    expect(spec.hitTest(obj, { x: 99, y: 99 })).toBe(false);
  });

  // TC-12: getObjectType('unknown') → undefined
  it('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  // Duplicate registration throws
  it('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 0,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow();
  });

  // Test-only testbox type
  it('testbox type can be registered and retrieved', () => {
    // Register testbox for use in component tests
    registerObjectType('testbox', {
      Component: () => null,
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
