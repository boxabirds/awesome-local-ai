// Unit tests for the object type registry (story 7, sel.registry):
// TC-11, TC-12, duplicate registration and the test-only `testbox` type.

import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType, type ObjectTypeSpec } from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { registerTestbox } from '../fixtures/testbox';

// Registers the test-only type for this module instance (idempotent).
registerTestbox();

function fakeSpec(): ObjectTypeSpec {
  return getObjectType('sticky')!;
}

describe('sel.registry (unit)', () => {
  it('TC-11: sticky spec is resizable, aspect-locked, minSize STICKY_MIN_SIZE_WORLD, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds and false outside (boundary: the edge itself)', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'n1',
      type: 'sticky',
      x: 0,
      y: 0,
      width: undefined,
      height: undefined,
      z: 1,
      createdAt: 0,
      color: 'yellow',
      text: '',
    }; // implicit 200x200 at (0,0)

    expect(spec.hitTest(obj, { x: 50, y: 50 })).toBe(true); // inside
    expect(spec.hitTest(obj, { x: 199, y: 0 })).toBe(true); // 1 unit inside the right edge
    expect(spec.hitTest(obj, { x: 200, y: 0 })).toBe(false); // on the edge: outside
    expect(spec.hitTest(obj, { x: 201, y: 0 })).toBe(false); // 1 unit outside
    expect(spec.hitTest(obj, { x: -1, y: 50 })).toBe(false); // outside on the left
    expect(spec.hitTest(obj, { x: 50, y: -1 })).toBe(false); // outside on top
  });

  it('TC-12: unknown type → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    expect(() => registerObjectType('sticky', fakeSpec())).toThrow();
    // A duplicate of the test type throws too.
    expect(() => registerObjectType('testbox', fakeSpec())).toThrow();
  });

  it('test-only testbox type is retrievable: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
  });
});
