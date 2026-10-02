import { describe, it, expect } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { registerTestbox, TESTBOX_MIN_SIZE } from '../fixtures/testbox';

// Importing the registry registers the built-in `sticky` type.
import '../../src/client/objects/registry';

describe('sel.registry (object type registry)', () => {
  // TC-11
  it('TC-11: the sticky spec declares resizable, aspectLocked, minSize STICKY_MIN_SIZE_WORLD, editableText', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();
  });

  it('TC-11: sticky hitTest is true inside the bounds and false 1 unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'n1', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0, width: 100, height: 100 };
    expect(spec.hitTest(obj, { x: 50, y: 50 })).toBe(true);
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(obj, { x: 100, y: 50 })).toBe(true); // exactly on the edge
    expect(spec.hitTest(obj, { x: 101, y: 50 })).toBe(false);
    expect(spec.hitTest(obj, { x: 50, y: 101 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 50 })).toBe(false);
    expect(spec.hitTest(obj, { x: 50, y: -1 })).toBe(false);
  });

  // TC-12
  it('TC-12: getObjectType of an unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow();
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    registerTestbox();
    const spec: ObjectTypeSpec | undefined = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
  });
});
