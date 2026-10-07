// Story 7 unit tests, task 7 (TC-11, TC-12, duplicate registration):
// coverage of the sel.registry contract.

import { describe, it, expect } from 'vitest';
import {
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { objectBounds } from '../../src/shared/board-model';
import { ensureTestBoxRegistered, TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';

describe('object type registry (story 7)', () => {
  it('TC-11: getObjectType("sticky") declares the sticky spec and boundary hit-test', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();

    // hitTest: true inside the bounds, false 1 unit outside (boundary).
    const obj = {
      id: 'n1',
      type: 'sticky',
      x: 0,
      y: 0,
      z: 0,
      text: '',
    };
    const bounds = objectBounds(obj);
    expect(spec!.hitTest(obj, { x: bounds.x + 1, y: bounds.y + 1 })).toBe(true);
    expect(spec!.hitTest(obj, { x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1 })).toBe(
      true,
    );
    expect(spec!.hitTest(obj, { x: bounds.x + bounds.width + 1, y: bounds.y + 1 })).toBe(false);
    expect(spec!.hitTest(obj, { x: bounds.x + 1, y: bounds.y - 1 })).toBe(false);
  });

  it('TC-12: getObjectType("unknown") is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow(/already registered/);
  });

  it('the test-only testbox type is retrievable with its declared spec', () => {
    ensureTestBoxRegistered();
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
    expect(spec!.Component).toBeTypeOf('function');
  });
});
