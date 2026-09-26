import { describe, it, expect } from 'vitest';
import { registerObjectType, getObjectType } from '@/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '@/shared/config';
import '../fixtures/testbox'; // self-registering test-only type (TC-11/TC-24)

// The registry registers 'sticky' at import; a duplicate registration is a
// programming error and must throw (task 7).
const duplicateSticky = () =>
  registerObjectType('sticky', {
    Component: () => null,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: () => false,
  });

describe('object type registry (story 7)', () => {
  it('TC-11: getObjectType("sticky") exposes the sticky spec and hit test', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();

    // hitTest: a 200x200 sticky at world (0,0).
    const obj = { id: 's', type: 'sticky', x: 0, y: 0, z: 0, createdAt: 0 };
    expect(spec!.hitTest(obj, { x: 10, y: 10 })).toBe(true); // inside
    expect(spec!.hitTest(obj, { x: 199, y: 199 })).toBe(true); // inside (boundary)
    expect(spec!.hitTest(obj, { x: 200, y: 10 })).toBe(false); // 0 units past right edge
    expect(spec!.hitTest(obj, { x: 10, y: 201 })).toBe(false); // 1 unit outside (boundary)
    expect(spec!.hitTest(obj, { x: -1, y: 10 })).toBe(false);
  });

  it('TC-12: getObjectType of an unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  it('duplicate registration of a known type throws', () => {
    expect(duplicateSticky).toThrow();
    // The original spec survives the failed re-registration.
    expect(getObjectType('sticky')!.editableText).toBe(true);
  });

  it('the test-only testbox type is registered (resizable, not aspect-locked, minSize 10)', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
  });
});
