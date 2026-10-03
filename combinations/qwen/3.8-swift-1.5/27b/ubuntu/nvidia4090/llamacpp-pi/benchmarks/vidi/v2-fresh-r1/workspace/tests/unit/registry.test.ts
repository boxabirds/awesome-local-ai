// TC-11, TC-12: the object type registry.

import { describe, expect, it } from 'vitest';
// Importing the registry registers the built-in 'sticky' type.
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

function stubSpec(overrides: Partial<Parameters<typeof registerObjectType>[1]> = {}) {
  return {
    Component: () => null,
    resizable: false,
    aspectLocked: false,
    minSize: 1,
    editableText: false,
    hitTest: () => false,
    ...overrides,
  };
}

describe('object registry', () => {
  // TC-11: every registered type has a component and a complete spec.
  it('TC-11 the sticky type is registered with a complete spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeTruthy();
    expect(spec!.Component).toBeTruthy();
    expect(typeof spec!.Component).toBe('function');
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.hitTest).toBe('function');
  });

  it('TC-11 the sticky hitTest is point-in-rect', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'a', type: 'sticky', x: 0, y: 0, z: 0, createdAt: 0, width: 100, height: 50 };
    expect(spec.hitTest(obj, { x: 10, y: 10 }, 1)).toBe(true);
    expect(spec.hitTest(obj, { x: 99.9, y: 49.9 }, 1)).toBe(true);
    expect(spec.hitTest(obj, { x: 100.1, y: 10 }, 1)).toBe(false);
    expect(spec.hitTest(obj, { x: -0.1, y: 10 }, 1)).toBe(false);
  });

  // TC-12: registering a duplicate type throws.
  it('TC-12 duplicate registration throws', () => {
    expect(() => registerObjectType('sticky', stubSpec())).toThrow(
      /already registered/,
    );
  });

  it('new types can be registered and looked up', () => {
    registerObjectType('rect-v1', stubSpec({ resizable: true }));
    expect(getObjectType('rect-v1')?.resizable).toBe(true);
  });

  it('unregistered types return undefined', () => {
    expect(getObjectType('does-not-exist')).toBeUndefined();
  });

  // Duplicate 'rect-v1' now throws (registered above).
  it('TC-12 re-registering a user type also throws', () => {
    expect(() => registerObjectType('rect-v1', stubSpec())).toThrow(/already registered/);
  });
});
