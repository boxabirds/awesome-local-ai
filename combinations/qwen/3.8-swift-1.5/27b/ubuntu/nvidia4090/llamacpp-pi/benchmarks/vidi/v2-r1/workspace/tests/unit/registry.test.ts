import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType, type ObjectTypeSpec } from '@client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';
import type { ObjectSnapshot } from '@shared/board-model';

function fakeSpec(overrides: Partial<ObjectTypeSpec> = {}): ObjectTypeSpec {
  return {
    Component: () => null,
    resizable: false,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: () => false,
    ...overrides,
  };
}

describe('sel.registry (object type registry)', () => {
  // TC-11: getObjectType('sticky') has the sticky spec
  it('TC-11: the sticky type is registered with resizable, aspectLocked and minSize 50', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11b: sticky hitTest is true inside bounds and false 1 unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'n1', type: 'sticky', x: 100, y: 100,
      width: 200, height: 200, z: 1, createdAt: 0,
    };
    // Inside
    expect(spec.hitTest(obj, { x: 101, y: 101 })).toBe(true);
    expect(spec.hitTest(obj, { x: 299, y: 299 })).toBe(true);
    // Centre
    expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true);
    // 1 unit outside (right)
    expect(spec.hitTest(obj, { x: 301, y: 200 })).toBe(false);
    // 1 unit outside (left)
    expect(spec.hitTest(obj, { x: 99, y: 200 })).toBe(false);
    // 1 unit outside (top)
    expect(spec.hitTest(obj, { x: 200, y: 99 })).toBe(false);
    // 1 unit outside (bottom)
    expect(spec.hitTest(obj, { x: 200, y: 301 })).toBe(false);
  });

  // TC-12: unknown type → undefined
  it('TC-12: getObjectType returns undefined for an unknown type', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    expect(() => registerObjectType('sticky', fakeSpec())).toThrow();
  });

  it('a newly registered type is retrievable', () => {
    registerObjectType('brandnew', fakeSpec({ resizable: true }));
    const spec = getObjectType('brandnew');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
  });
});
