import { describe, expect, it } from 'vitest';

import { getObjectType, registerObjectType, type ObjectTypeSpec } from '../../src/client/objects/registry.js';
import { type ObjectSnapshot } from '../../src/shared/board-model.js';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config.js';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE } from '../fixtures/testbox.js';

/**
 * The object type registry (unit, `sel.registry`). The registry is declarative
 * data - a lookup - so this only mounts a real Y.Doc-free module surface: the
 * sticky spec's fields, the unknown-type answer, the duplicate-registration
 * programming error, and that a test-only type round-trips.
 */

/** A sticky drawn at the origin at its default size - enough for a hit test. */
function stickyAtOrigin(): ObjectSnapshot {
  return {
    id: 'sticky-1',
    type: 'sticky',
    x: 0,
    y: 0,
    z: 1,
    createdAt: 1,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
  };
}

describe('object registry (TC-11, TC-12)', () => {
  it('TC-11 registers sticky as a resizable, aspect-locked, editable type', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('TC-11 hitTest is true inside the bounds and false one unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const object = stickyAtOrigin();
    // The far edge sits at STICKY_SIZE_WORLD; a point on or inside it is a hit.
    expect(spec.hitTest!(object, { x: 10, y: 10 })).toBe(true);
    expect(spec.hitTest!(object, { x: STICKY_SIZE_WORLD, y: STICKY_SIZE_WORLD })).toBe(true);
    // One world unit beyond either edge is a miss.
    expect(spec.hitTest!(object, { x: STICKY_SIZE_WORLD + 1, y: 10 })).toBe(false);
    expect(spec.hitTest!(object, { x: 10, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
  });

  it('TC-12 returns undefined for a type this build cannot draw', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('a duplicate registration of one type throws (programming error path)', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
    };
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/u);
    // The throw is the whole story; the original spec is untouched.
    expect(getObjectType('sticky')?.aspectLocked).toBe(true);
  });

  it('a test-only non-locked type is retrievable (proves the registry is generic)', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec?.editableText).toBe(false);
  });
});
