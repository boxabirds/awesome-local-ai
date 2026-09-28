import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType, registerSticky, _resetRegistryForTests, type ObjectTypeSpec } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

// Register sticky at module load (what App does at startup).
registerSticky(() => null);

describe('object type registry', () => {
  it('TC-11: getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds, false outside', () => {
    const spec = getObjectType('sticky')!;
    // Object is 200x200 at (0,0) (default STICKY_SIZE_WORLD).
    const obj = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1 };
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // Just inside boundary
    expect(spec.hitTest(obj, { x: 199, y: 199 })).toBe(true);
    // 1 unit outside
    expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12: getObjectType for unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() => registerObjectType('sticky', {} as ObjectTypeSpec)).toThrow();
  });

  it('testbox type can be registered and retrieved', () => {
    const testSpec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    };
    registerObjectType('testbox', testSpec);
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
