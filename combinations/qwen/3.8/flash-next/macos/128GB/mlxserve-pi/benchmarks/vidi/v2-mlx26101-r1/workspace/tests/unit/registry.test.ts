import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
// Importing the fixture registers the test-only `testbox` type at module load.
import {
  TESTBOX_MIN_SIZE_WORLD,
} from '../fixtures/testbox';

const sticky: ObjectSnapshot = {
  id: 'a',
  type: 'sticky',
  x: 100,
  y: 100,
  z: 1,
  createdAt: 0,
};

describe('sel.registry', () => {
  // TC-11: sticky is registered with the generic knobs, and hit-tests its bounds.
  it('TC-11 registers sticky as resizable, aspect-locked, min 50, editable', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    // Inside its bounds (100..300 by STICKY_SIZE_WORLD fallback) hits; one unit
    // outside misses.
    expect(spec!.hitTest(sticky, { x: 150, y: 150 })).toBe(true);
    expect(spec!.hitTest(sticky, { x: 99, y: 150 })).toBe(false);
  });

  // TC-12: an unregistered type is undefined (and therefore never selectable).
  // Story 10 took `shape` and `connector` as stand-ins and story 12 took `image`, so this asks with a
  // type the app genuinely cannot paint: `frame`. The point of the test is not which word, it is that
  // a type nobody registered has no renderer — and story 12 is the reason that has to keep being true,
  // because a document written by a newer client can contain a type this one has never heard of.
  it('TC-12 getObjectType is undefined for an unknown type', () => {
    expect(getObjectType('frame')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('registering the same type twice throws (a programming error)', () => {
    expect(() =>
      registerObjectType('sticky', getObjectType('sticky')!),
    ).toThrow(/already registered/);
  });

  it('the test-only testbox type is registered and not aspect-locked', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
  });
});
