import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import {
  getObjectType,
  hitTestBounds,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
// Importing the fixture is what registers the test-only type (module side effect).
import { TESTBOX_MIN_SIZE_WORLD, TESTBOX_TYPE, TestBox } from '../fixtures/testbox';

/**
 * Unit tests for the object type registry (anchor `sel.registry`). The registry
 * is the only place a story 9-12 object type says anything about itself, so its
 * lookups and its duplicate-registration rule are tested directly.
 */

/** A sticky note as the board model describes it, with no stored size. */
const implicitSticky: ObjectSnapshot = Object.freeze({
  id: 'sticky-1',
  type: 'sticky',
  x: 0,
  y: 0,
  z: 1,
  createdAt: 0,
});

const specOf = (type: string): ObjectTypeSpec => {
  const spec = getObjectType(type);
  if (!spec) {
    throw new Error(`${type} is not registered`);
  }
  return spec;
};

describe('sel.registry - sticky notes (TC-11)', () => {
  // TC-11
  it('TC-11 the sticky spec declares exactly the per-type knobs story 7 allows', () => {
    const spec = specOf('sticky');
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(true);
    expect(spec.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(true);
    expect(typeof spec.Component).toBe('function');
    // The only knobs are these: no behaviour of its own.
    expect(Object.keys(spec).sort()).toEqual([
      'Component',
      'aspectLocked',
      'editableText',
      'hitTest',
      'minSize',
      'resizable',
    ]);
  });

  // TC-11 boundary: 1 unit inside the bounds, 1 unit outside. A snapshot's
  // (x, y) is its top-left corner, so the box runs from (0, 0) to (200, 200).
  it('TC-11 the sticky hit test is true inside its bounds and false one unit outside', () => {
    const spec = specOf('sticky');
    expect(spec.hitTest(implicitSticky, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(implicitSticky, { x: 1, y: 1 })).toBe(true);
    expect(spec.hitTest(implicitSticky, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 })).toBe(true);
    expect(spec.hitTest(implicitSticky, { x: STICKY_SIZE_WORLD - 1, y: STICKY_SIZE_WORLD - 1 })).toBe(true);
    expect(spec.hitTest(implicitSticky, { x: -1, y: 0 })).toBe(false);
    expect(spec.hitTest(implicitSticky, { x: 0, y: -1 })).toBe(false);
    expect(spec.hitTest(implicitSticky, { x: STICKY_SIZE_WORLD + 1, y: 0 })).toBe(false);
    expect(spec.hitTest(implicitSticky, { x: 0, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
  });

  it('a hit test on a resized object follows the stored width and height', () => {
    const spec = specOf('sticky');
    const grown: ObjectSnapshot = { ...implicitSticky, x: 100, y: 50, width: 400, height: 300 };
    expect(spec.hitTest(grown, { x: 101, y: 51 })).toBe(true);
    expect(spec.hitTest(grown, { x: 499, y: 349 })).toBe(true);
    expect(spec.hitTest(grown, { x: 501, y: 349 })).toBe(false);
    expect(spec.hitTest(grown, { x: 499, y: 351 })).toBe(false);
    expect(spec.hitTest(grown, { x: 99, y: 349 })).toBe(false);
  });

  it('hitTestBounds is the plain-rectangle test any rectangular type can reuse', () => {
    const box: ObjectSnapshot = { ...implicitSticky, width: 100, height: 50 };
    expect(hitTestBounds(box, { x: 0, y: 0 })).toBe(true);
    expect(hitTestBounds(box, { x: 49, y: 24 })).toBe(true);
    expect(hitTestBounds(box, { x: 99, y: 49 })).toBe(true);
    expect(hitTestBounds(box, { x: 101, y: 24 })).toBe(false);
    expect(hitTestBounds(box, { x: 24, y: 51 })).toBe(false);
  });
});

describe('sel.registry - unknown types (TC-12)', () => {
  // TC-12. The names here are ones nothing registers: story 10 filled in 'shape'
  // and 'connector', which is exactly what this anchor is for - a type the registry
  // has never heard of is the one a board cannot draw, select or transform.
  it('TC-12 a type nothing registered has no spec', () => {
    expect(getObjectType('not-a-board-type')).toBeUndefined();
    expect(getObjectType('whiteboard-thing')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('an unknown type therefore declares nothing about resizing', () => {
    const spec = getObjectType('not-a-board-type');
    expect(spec?.resizable).toBeUndefined();
    expect(spec?.minSize).toBeUndefined();
  });
});

describe('sel.registry - duplicate registration (programming error)', () => {
  it('registering a type that is already registered throws', () => {
    const again: ObjectTypeSpec = {
      Component: TestBox,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: hitTestBounds,
    };
    expect(() => registerObjectType('sticky', again)).toThrow();
    expect(() => registerObjectType(TESTBOX_TYPE, again)).toThrow();
    // And the first registration is still the one in force.
    expect(specOf('sticky').minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(specOf('sticky').resizable).toBe(true);
  });
});

describe('sel.registry - the test-only type component tests rely on', () => {
  it('testbox is registered by importing the fixture: resizable, not aspect-locked', () => {
    const spec = specOf(TESTBOX_TYPE);
    expect(spec.Component).toBe(TestBox);
    expect(spec.resizable).toBe(true);
    // The point of the fixture: a resize that may change one axis only.
    expect(spec.aspectLocked).toBe(false);
    expect(spec.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec.minSize).toBeLessThan(STICKY_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(false);
  });
});
