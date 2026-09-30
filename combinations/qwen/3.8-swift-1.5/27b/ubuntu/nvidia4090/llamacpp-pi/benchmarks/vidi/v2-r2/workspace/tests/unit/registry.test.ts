import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectTypeSpec } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { registerTestBox, TESTBOX_TYPE, TESTBOX_MIN_SIZE } from '../fixtures/testbox';

const fakeSpec: ObjectTypeSpec = {
  Component: () => null,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: () => false,
};

describe('sel.registry (unit)', () => {
  it('TC-11: the sticky spec is retrievable with sticky semantics and a bounds hitTest', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);

    const obj = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 200, height: 200 } as const;
    // Inside the bounds (including implicit-size stickies without width/height).
    expect(spec!.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec!.hitTest({ id: 'b', type: 'sticky', x: 0, y: 0, z: 1 } as const, { x: 50, y: 50 })).toBe(true);
    // 1 unit outside the bounds → false.
    expect(spec!.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    expect(spec!.hitTest(obj, { x: 100, y: 201 })).toBe(false);
  });

  it('TC-12: unknown types → undefined (forward compatibility: no throw)', () => {
    expect(getObjectType('pen')).toBeUndefined();
    expect(getObjectType('does-not-exist')).toBeUndefined();
  });

  it('a duplicate type id registration throws', () => {
    expect(() => registerObjectType('sticky', fakeSpec)).toThrow();
  });

  it('the test-only testbox type is registered (resizable, not aspect-locked, minSize 10)', () => {
    registerTestBox();
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
  });
});
