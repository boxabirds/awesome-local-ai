/**
 * Story 7 · task 7 — registry unit tests (TC-11, TC-12, duplicate registration).
 *
 * Pure lookups against the module-level registry: no DOM, no React. The
 * registry only carries per-type *behaviour* (resize rules + a pure hit test),
 * which is the seam stories 9–12 plug new shapes into without touching the
 * transform code (`sel.all_types`).
 */
import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_MIN_SIZE, ensureTestboxRegistered } from '../fixtures/testbox';

describe('sticky spec (TC-11)', () => {
  it('declares a square, aspect-locked, resizable, editable note', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('hit-tests true inside its bounds and false one unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const note = { id: 'n', type: 'sticky', x: 0, y: 0, z: 1, width: 200, height: 200, createdAt: 0 };
    // The centre is a hit; a point just beyond the right edge is not.
    expect(spec.hitTest(note, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(note, { x: 201, y: 100 })).toBe(false);
  });
});

describe('unknown type (TC-12)', () => {
  it('resolves to undefined so it is neither selectable nor resizable', () => {
    expect(getObjectType('shape')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });
});

describe('duplicate registration (error path)', () => {
  it('throws when a type is registered twice (a programming error)', () => {
    registerObjectType('widget-unique', {
      resizable: true,
      aspectLocked: false,
      minSize: 5,
      editableText: false,
      hitTest: () => true,
    });
    expect(() =>
      registerObjectType('widget-unique', {
        resizable: false,
        aspectLocked: false,
        minSize: 5,
        editableText: false,
        hitTest: () => true,
      }),
    ).toThrow(/already registered/);
  });
});

describe('test-only type (TC-24 basis)', () => {
  it('registers a freely-resizable, non-aspect-locked rectangle', () => {
    ensureTestboxRegistered();
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE);
  });
});
