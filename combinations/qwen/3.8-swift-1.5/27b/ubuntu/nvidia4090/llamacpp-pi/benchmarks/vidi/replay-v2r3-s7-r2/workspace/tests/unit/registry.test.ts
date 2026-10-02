import { describe, it, expect } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE } from '../fixtures/testbox';

/**
 * Story 7, sel.registry: the object type registry (unit level).
 * TC-11, TC-12, duplicate registration, and the test-only `testbox` fixture.
 */

function stickyObj(x: number, y: number, width = 200, height = 200): ObjectSnapshot {
  return { id: 's', type: 'sticky', x, y, z: 1, createdAt: 0, width, height, color: 'yellow', text: '' };
}

describe('object type registry', () => {
  // TC-11
  it('TC-11: the sticky spec declares resize rules and a bounds hit test', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();

    // hitTest: true inside the bounds, false 1 unit outside (boundary).
    const obj = stickyObj(0, 0, 100, 100);
    expect(spec!.hitTest(obj, { x: 50, y: 50 })).toBe(true);
    expect(spec!.hitTest(obj, { x: 0.5, y: 0.5 })).toBe(true);
    expect(spec!.hitTest(obj, { x: 101, y: 50 })).toBe(false);
    expect(spec!.hitTest(obj, { x: -1, y: 50 })).toBe(false);
    expect(spec!.hitTest(obj, { x: 50, y: -1 })).toBe(false);
  });

  // TC-12
  it('TC-12: unknown types return undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
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

  it('the test-only testbox type is registered (resizable, not aspect-locked, minSize 10)', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
    // Sanity: the spec shape is a plain data contract.
    const keys = Object.keys(spec! as ObjectTypeSpec).sort();
    expect(keys).toEqual(
      ['Component', 'aspectLocked', 'editableText', 'hitTest', 'minSize', 'resizable'],
    );
  });
});
