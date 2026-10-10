// TC-11, TC-12 and duplicate registration for the object-type registry.

import { describe, expect, it } from 'vitest';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';

const STICKY_MIN_SIZE_WORLD = 50;

const sticky: ObjectSnapshot = {
  id: 'a',
  type: 'sticky',
  x: 100,
  y: 200,
  z: 1,
  createdAt: 1,
};

describe('object type registry', () => {
  it('TC-11: sticky declares resizable, aspect-locked, min 50 and editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(spec?.Component).toBeDefined();
  });

  it('TC-12: an unregistered type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('hitTest is bounds containment, including implicit size', () => {
    const spec = getObjectType('sticky');
    expect(spec?.hitTest(sticky, { x: 100, y: 200 })).toBe(true);
    expect(spec?.hitTest(sticky, { x: 299.9, y: 399.9 })).toBe(true);
    expect(spec?.hitTest(sticky, { x: 300, y: 400 })).toBe(true); // edge inclusive
    expect(spec?.hitTest(sticky, { x: 300.1, y: 400.1 })).toBe(false);
    expect(spec?.hitTest(sticky, { x: 99, y: 200 })).toBe(false);
  });

  it('duplicate registration throws', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow(/sticky/);
  });
});
