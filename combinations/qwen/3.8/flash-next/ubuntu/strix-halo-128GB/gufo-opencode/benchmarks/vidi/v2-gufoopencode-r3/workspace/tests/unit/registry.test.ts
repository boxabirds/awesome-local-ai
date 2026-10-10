import { describe, expect, test } from 'vitest';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType, registerObjectType, type ObjectTypeSpec } from '../../src/client/objects/registry';
import { registerTestbox } from '../fixtures/testbox';

describe('object type registry', () => {
  // TC-11
  test('TC-11 sticky spec: resizable, aspect-locked, min size, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(spec?.Component).toBeDefined();
  });

  // TC-11 boundary: hitTest inside vs 1 unit outside
  test('TC-11 hitTest true inside bounds, false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'n1', type: 'sticky', x: 100, y: 200, z: 1 };
    const size = 200; // STICKY_SIZE_WORLD
    expect(spec.hitTest(obj, { x: 100, y: 200 })).toBe(true); // corner inclusive
    expect(spec.hitTest(obj, { x: 100 + size / 2, y: 200 + size / 2 })).toBe(true); // centre
    expect(spec.hitTest(obj, { x: 100 + size - 1, y: 200 + size / 2 })).toBe(true);
    expect(spec.hitTest(obj, { x: 100 + size + 1, y: 200 + size / 2 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100 - 1, y: 200 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: 200 + size + 1 })).toBe(false);
  });

  // TC-12
  test('TC-12 unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  test('duplicate registration throws (programming error)', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => false
    };
    registerObjectType('dup-type', spec);
    expect(() => registerObjectType('dup-type', spec)).toThrow(/dup-type/);
  });

  test('test-only testbox type is registered and retrievable', () => {
    registerTestbox();
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(10);
  });
});
