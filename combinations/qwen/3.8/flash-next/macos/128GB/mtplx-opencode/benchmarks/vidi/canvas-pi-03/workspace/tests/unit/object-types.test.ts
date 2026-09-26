import { describe, it, expect } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  resetObjectTypes,
  anyResizable,
  anyAspectLocked,
  minSizeOf,
  STICKY_SPEC,
} from '../../src/shared/object-types';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectTypeSpec } from '../../src/shared/object-types';

describe('object type registry (sel.registry)', () => {
  it('TC-11: sticky declares resize, aspect lock, minimum size and text editing', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec).toBe(STICKY_SPEC);
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside the bounds and false one unit outside', () => {
    const spec = getObjectType('sticky');
    const bounds = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    expect(spec?.hitTest(bounds, { x: 100, y: 100 })).toBe(true);
    // Boundary: exactly on the edge still counts as a hit.
    expect(spec?.hitTest(bounds, { x: STICKY_SIZE_WORLD, y: STICKY_SIZE_WORLD })).toBe(true);
    // One unit past the bottom-right corner is a miss.
    expect(spec?.hitTest(bounds, { x: STICKY_SIZE_WORLD + 1, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
    expect(spec?.hitTest(bounds, { x: -1, y: 50 })).toBe(false);
  });

  it('TC-12: an unknown type resolves to undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType(undefined)).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  it('registering the same type twice throws (programming error)', () => {
    expect(() => registerObjectType(STICKY_SPEC)).toThrow(/already registered/);
  });

  it('a test-only resizable, non-locked type is retrievable and drives the generic knobs', () => {
    // This is the fixture the component tests use to prove selection/resize are
    // generic rather than sticky-specific.
    const testbox: ObjectTypeSpec = {
      type: 'testbox',
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (bounds, point) =>
        point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height,
    };
    registerObjectType(testbox);
    expect(getObjectType('testbox')).toBe(testbox);
    expect(getObjectType('testbox')?.aspectLocked).toBe(false);

    // Mixed selection: aspect lock is contagious, the tightest minimum wins.
    expect(anyAspectLocked(['sticky'])).toBe(true);
    expect(anyAspectLocked(['testbox'])).toBe(false);
    expect(anyAspectLocked(['testbox', 'sticky'])).toBe(true);
    expect(anyResizable(['testbox'])).toBe(true);
    expect(anyResizable(['unknown'])).toBe(false);
    expect(minSizeOf(['sticky', 'testbox'], 50)).toBe(10);
    expect(minSizeOf(['sticky'], 50)).toBe(50);
  });

  it('resetObjectTypes restores the built-in registration', () => {
    resetObjectTypes();
    expect(getObjectType('testbox')).toBeUndefined();
    expect(getObjectType('sticky')).toBe(STICKY_SPEC);
  });
});
