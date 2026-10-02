import { describe, it, expect } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import '../fixtures/testbox';

/**
 * Story 7 unit tests for the object-type registry (sel.registry),
 * TC-11, TC-12 and the duplicate-registration error path.
 */

describe('object type registry (sel.registry)', () => {
  // TC-11
  it('TC-11: the sticky spec declares resizable, aspectLocked, minSize and editableText', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');
  });

  it('TC-11 boundary: sticky hitTest is true inside the bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'n1',
      type: 'sticky',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      z: 1,
      createdAt: 0,
    };
    // Inside (including just at the top-left corner).
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // 1 unit outside each edge.
    expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: 201 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: -1 })).toBe(false);
  });

  // TC-12
  it('TC-12: an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec as ObjectTypeSpec)).toThrow();
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
