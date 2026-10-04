import { describe, expect, it } from 'vitest';

import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { TESTBOX_MIN_SIZE_WORLD, TESTBOX_TYPE, testboxSpec } from '../fixtures/testbox';

function sticky(over: Partial<ObjectSnapshot> = {}): ObjectSnapshot {
  return {
    id: 'a',
    type: 'sticky',
    x: 0,
    y: 0,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    z: 1,
    createdAt: 0,
    ...over,
  };
}

describe('objects.registry — sticky notes', () => {
  it('TC-11: sticky declares itself resizable, square and 50 units at the smallest', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');
  });

  it('TC-11: hitTest is true inside the note and false one unit outside', () => {
    const spec = getObjectType('sticky')!;
    expect(spec.hitTest(sticky(), { x: 100, y: 100 })).toBe(true);
    // On the edge is inside; one unit past it is not (boundary).
    expect(spec.hitTest(sticky(), { x: STICKY_SIZE_WORLD, y: 100 })).toBe(true);
    expect(spec.hitTest(sticky(), { x: STICKY_SIZE_WORLD + 1, y: 100 })).toBe(false);
    expect(spec.hitTest(sticky(), { x: -1, y: 100 })).toBe(false);
    expect(spec.hitTest(sticky(), { x: 100, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
  });

  it('hitTest measures a note created before width and height existed', () => {
    const spec = getObjectType('sticky')!;
    const legacy = sticky({ id: 'legacy', width: undefined, height: undefined });
    expect(spec.hitTest(legacy, { x: STICKY_SIZE_WORLD - 1, y: STICKY_SIZE_WORLD - 1 })).toBe(true);
    expect(spec.hitTest(legacy, { x: STICKY_SIZE_WORLD + 1, y: 1 })).toBe(false);
  });
});

describe('objects.registry — other types', () => {
  it('TC-12: an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('a test-only type is registered and readable: resizable, free proportions', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec).toBe(testboxSpec);
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
  });

  it('registering the same type twice throws: a duplicate is a programming error', () => {
    expect(() => registerObjectType('sticky', testboxSpec)).toThrowError(/sticky/);
    expect(() => registerObjectType(TESTBOX_TYPE, testboxSpec)).toThrowError(/testbox/);
  });

  it('a spec is stored unchanged (the registry holds the only knobs a type gets)', () => {
    const spec: ObjectTypeSpec = { ...testboxSpec };
    expect(() => registerObjectType('a-brand-new-type', spec)).not.toThrow();
    expect(getObjectType('a-brand-new-type')).toBe(spec);
  });
});
