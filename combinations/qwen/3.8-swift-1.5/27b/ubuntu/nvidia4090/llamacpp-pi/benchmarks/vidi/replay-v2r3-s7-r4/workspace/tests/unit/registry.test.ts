import { describe, it, expect } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_MIN_SIZE_WORLD } from '../fixtures/testbox';

function dummyComponent(_props: ObjectProps): null {
  return null;
}

describe('sel.registry (object type registry)', () => {
  // TC-11
  it('TC-11: getObjectType("sticky") → resizable, aspect-locked, minSize 50, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeTypeOf('function');

    // hitTest: true inside the bounds, false 1 unit outside (boundary).
    const obj = { id: 'n1', type: 'sticky', x: 100, y: 100, z: 1, createdAt: 0 };
    const bounds = objectBounds(obj);
    expect(spec!.hitTest(obj, { x: bounds.x + 1, y: bounds.y + 1 })).toBe(true);
    expect(spec!.hitTest(obj, { x: bounds.x + STICKY_SIZE_WORLD / 2, y: bounds.y + STICKY_SIZE_WORLD / 2 })).toBe(true);
    expect(spec!.hitTest(obj, { x: bounds.x + bounds.width + 1, y: bounds.y + 1 })).toBe(false);
    expect(spec!.hitTest(obj, { x: bounds.x + 1, y: bounds.y + bounds.height + 1 })).toBe(false);
    expect(spec!.hitTest(obj, { x: bounds.x - 1, y: bounds.y - 1 })).toBe(false);
  });

  // TC-12
  it('TC-12: getObjectType("unknown") → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    const existing = getObjectType('sticky');
    expect(() => registerObjectType('sticky', existing!)).toThrow();
    // A fresh name registers fine and is retrievable.
    const spec: Parameters<typeof registerObjectType>[1] = {
      Component: dummyComponent,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    };
    registerObjectType('story7-test-type', spec);
    expect(getObjectType('story7-test-type')).toBe(spec);
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
  });
});
