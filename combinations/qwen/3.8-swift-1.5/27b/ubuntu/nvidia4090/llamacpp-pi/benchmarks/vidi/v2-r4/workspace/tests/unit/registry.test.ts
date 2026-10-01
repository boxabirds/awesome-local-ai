import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType, type ObjectTypeSpec } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

// Import the registry to ensure sticky is registered
import '../../src/client/objects/registry';

describe('registry unit tests', () => {
  // TC-11: getObjectType('sticky') → correct spec
  it('TC-11: getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();
  });

  it('TC-11: sticky hitTest is true inside bounds and false outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = { id: 'test', type: 'sticky', x: 0, y: 0, width: 200, height: 200, z: 1 };

    // Inside
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(obj, { x: 199, y: 199 })).toBe(true);

    // Outside (1 unit beyond)
    expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: 201 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
  });

  // TC-12: getObjectType('unknown') → undefined
  it('TC-12: getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  // Duplicate registration throws
  it('duplicate registerObjectType throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow(/Duplicate registration/);
  });

  // Test-only type registration
  it('can register and retrieve a new type', () => {
    const testSpec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => false,
    };
    registerObjectType('test-type-unique', testSpec);
    const retrieved = getObjectType('test-type-unique');
    expect(retrieved).toBe(testSpec);
  });
});
