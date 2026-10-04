import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType, type ObjectTypeSpec } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

// Importing the registry module triggers the sticky registration
import '../../src/client/objects/registry';

describe('object type registry', () => {
  // TC-11
  it('TC-11: getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();

    // hitTest: true inside bounds
    const obj = { id: 'test', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 };
    expect(spec!.hitTest(obj, { x: 100, y: 100 })).toBe(true);

    // hitTest: true at exact edge (boundary)
    expect(spec!.hitTest(obj, { x: 0, y: 0 })).toBe(true);

    // hitTest: false 1 unit outside
    expect(spec!.hitTest(obj, { x: -1, y: 100 })).toBe(false);
    expect(spec!.hitTest(obj, { x: 100, y: -1 })).toBe(false);
    // 200 is the default size, so x=200 is outside (bounds are [0, 200))
    expect(spec!.hitTest(obj, { x: 200, y: 100 })).toBe(false);
  });

  // TC-12
  it('TC-12: getObjectType("unknown") → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('mystery-type-12')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    // Known types are registered (sticky, text, shape, connector — story 10)
    expect(getObjectType('sticky')).toBeDefined();
    expect(getObjectType('text')).toBeDefined();
    expect(getObjectType('shape')).toBeDefined();
    expect(getObjectType('connector')).toBeDefined();
  });

  it('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: true,
        aspectLocked: true,
        minSize: 50,
        editableText: true,
        hitTest: () => false,
      });
    }).toThrow(/already registered/);
  });

  it('test-only testbox type can be registered and retrieved', () => {
    // Register a test-only type
    const testboxSpec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (obj, point) => {
        const w = obj.width ?? 100;
        const h = obj.height ?? 100;
        return point.x >= obj.x && point.y >= obj.y && point.x < obj.x + w && point.y < obj.y + h;
      },
    };

    // Use a unique name to avoid conflicts with other test runs
    const testType = 'testbox_' + Date.now();
    registerObjectType(testType, testboxSpec);

    const retrieved = getObjectType(testType);
    expect(retrieved).toBeDefined();
    expect(retrieved!.resizable).toBe(true);
    expect(retrieved!.aspectLocked).toBe(false);
    expect(retrieved!.minSize).toBe(10);
  });
});
