/**
 * The object type registry (story 7, TC-11, TC-12).
 *
 * `sel.all_types` is the requirement these two tests are about: the board may
 * hold a type this build has never seen, and the selection machinery must still
 * work on what it does know. Everything the selection needs to know about a type
 * is answered here or nowhere, which is also why the test registers a second
 * type (`tests/fixtures/testbox.tsx`) and asks the same questions of both.
 */

import { describe, expect, it } from 'vitest';

import { getObjectType, objectTypeNames, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectTypeSpec } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { STICKY_TYPE } from '../../src/shared/board-model';
import { centreOf } from '../fixtures/testbox';
import { TESTBOX_MIN_SIZE_WORLD, TESTBOX_TYPE } from '../fixtures/testbox';

/** The sticky note's own answers (TC-11). */
describe('the sticky note is registered like any other type (TC-11)', () => {
  const spec = getObjectType(STICKY_TYPE);

  it('sticky is in the registry, with a component to render it', () => {
    expect(spec).toBeDefined();
    expect(typeof spec?.Component).toBe('function');
  });

  it('it can be resized, keeps its proportions, and stops at STICKY_MIN_SIZE_WORLD', () => {
    // A sticky note is a square: story 7 may resize it, but only as a square.
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('hit testing follows the rectangle it is drawn at, edge included', () => {
    const note = {
      id: 'n1',
      type: STICKY_TYPE,
      x: 100,
      y: 200,
      z: 1,
      createdAt: 1,
    };
    expect(spec?.hitTest(note, centreOf({ x: 100, y: 200, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD }))).toBe(
      true,
    );
    // The default size of a note that has never been resized.
    const bounds = { x: 100, y: 200, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    expect(spec?.hitTest(note, centreOf(bounds))).toBe(true);
    expect(spec?.hitTest(note, { x: bounds.x + bounds.width + 1, y: 200 })).toBe(false);
    expect(spec?.hitTest(note, { x: 100, y: bounds.y - 1 })).toBe(false);
    // A resized note is hit tested at its stored size.
    const grown = { ...note, width: 600, height: 300 };
    expect(spec?.hitTest(grown, { x: 100 + 599, y: 200 + 299 })).toBe(true);
    expect(spec?.hitTest(grown, { x: 100 + 601, y: 200 })).toBe(false);
  });
});

/** A second type proves the selection could not have been written for one. */
describe('a second type is registered the same way (TC-12 support)', () => {
  it('the test box says what a sticky note does not: resizable, not locked, min 10', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(false);
  });

  it('both types are named by the registry, and nothing else is', () => {
    const names = objectTypeNames();
    expect(names).toContain(STICKY_TYPE);
    expect(names).toContain(TESTBOX_TYPE);
    expect(names).not.toContain('shape');
  });
});

describe('a type this build does not know (TC-12)', () => {
  it('has no spec, and asking for one does not crash', () => {
    expect(getObjectType('shape')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(getObjectType('Sticky')).toBeUndefined();
  });

  it('registering a type twice is refused rather than silently rebound', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    };
    expect(() => registerObjectType(STICKY_TYPE, spec)).toThrowError(/sticky/);
    expect(() => registerObjectType('shape', spec)).not.toThrow();
    expect(getObjectType('shape')).toBe(spec);
    // …and the second attempt at the new type is refused too, so the first
    // answer stays the only one.
    expect(() => registerObjectType('shape', spec)).toThrowError(/shape/);
  });
});
