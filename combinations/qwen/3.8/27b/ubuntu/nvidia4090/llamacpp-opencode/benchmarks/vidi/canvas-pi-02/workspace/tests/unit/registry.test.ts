import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectTypeSpec } from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import '../fixtures/testbox';
import { TESTBOX_MIN_SIZE } from '../fixtures/testbox';

/**
 * Story 7 registry unit tests (task 7, TC-11, TC-12, duplicate registration,
 * and the test-only `testbox` type used by the component tests).
 */

const STICKY_AT_ORIGIN: ObjectSnapshot = {
  id: 'sticky-1',
  type: 'sticky',
  x: 0,
  y: 0,
  z: 1,
  createdAt: 0,
};

describe('registry (TC-11, TC-12)', () => {
  it('TC-11 getObjectType("sticky") exposes the sticky knobs', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();
  });

  it('TC-11 hitTest is true inside the bounds and false 1 unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const bounds = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD }; // 200
    expect(spec.hitTest(STICKY_AT_ORIGIN, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(STICKY_AT_ORIGIN, { x: 0, y: 0 })).toBe(true); // corner (inclusive)
    expect(spec.hitTest(STICKY_AT_ORIGIN, { x: STICKY_SIZE_WORLD, y: 100 })).toBe(true); // edge (inclusive)
    expect(spec.hitTest(STICKY_AT_ORIGIN, { x: STICKY_SIZE_WORLD + 1, y: 100 })).toBe(false); // 1 outside
    expect(spec.hitTest(STICKY_AT_ORIGIN, { x: -1, y: 100 })).toBe(false);
    // A resized sticky (explicit width/height) hits against its stored size.
    const resized: ObjectSnapshot = { ...STICKY_AT_ORIGIN, width: 300, height: 100 };
    expect(spec.hitTest(resized, { x: 250, y: 50 })).toBe(true);
    expect(spec.hitTest(resized, { x: 301, y: 50 })).toBe(false);
  });

  it('TC-12 getObjectType("unknown") → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    const spec: ObjectTypeSpec = {
      Component: (() => null) as ObjectTypeSpec['Component'],
      resizable: false,
      handles: 'all',
      aspectLocked: false,
      minSize: 0,
      editableText: false,
      hitTest: () => false,
    };
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
    // The original registration survives the failed attempt.
    expect(getObjectType('sticky')?.aspectLocked).toBe(true);
  });
});

describe('testbox fixture (test-only generic type)', () => {
  it('TC-12 (fixture) the test-only type is retrievable: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
    expect(spec!.Component).toBeDefined();
  });
});
