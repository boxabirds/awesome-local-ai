import { describe, it, expect } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { registerTestBox, TESTBOX_MIN_SIZE } from '../fixtures/testbox';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7 (sel.registry): the object-type registry. TC-11, TC-12 plus the
 * duplicate-registration programming error and the test-only `testbox` type.
 */
describe('object type registry (sel.registry)', () => {
  // TC-11
  it('TC-11: getObjectType("sticky") declares resizable, aspect-locked, min 50, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();
    // hitTest: true inside the bounds, false 1 unit outside (boundary).
    const obj = { id: 'n1', type: 'sticky', x: 100, y: 100, z: 1, width: 200, height: 200 };
    expect(spec!.hitTest(obj, { x: 100, y: 100 })).toBe(true); // top-left corner
    expect(spec!.hitTest(obj, { x: 200, y: 200 })).toBe(true); // centre
    expect(spec!.hitTest(obj, { x: 299, y: 299 })).toBe(true); // 1 inside the edge
    expect(spec!.hitTest(obj, { x: 301, y: 150 })).toBe(false); // 1 unit outside the right edge
    expect(spec!.hitTest(obj, { x: 150, y: 301 })).toBe(false); // 1 unit outside the bottom edge
    expect(spec!.hitTest(obj, { x: 99, y: 150 })).toBe(false); // 1 unit outside the left edge
    expect(spec!.hitTest(obj, { x: 150, y: 99 })).toBe(false); // 1 unit outside the top edge
  });

  // TC-12
  it('TC-12: getObjectType("unknown") → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    };
    expect(() => registerObjectType('sticky', spec)).toThrow();
    // The original spec is unchanged.
    expect(getObjectType('sticky')!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('a new type can be registered once and is retrievable', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 42,
      editableText: false,
      hitTest: () => false,
    };
    registerObjectType('one-shot-type', spec);
    expect(getObjectType('one-shot-type')).toBe(spec);
  });

  it('test-only testbox type: resizable, not aspect-locked, minSize 10 (fixture)', () => {
    registerTestBox();
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
  });
});
