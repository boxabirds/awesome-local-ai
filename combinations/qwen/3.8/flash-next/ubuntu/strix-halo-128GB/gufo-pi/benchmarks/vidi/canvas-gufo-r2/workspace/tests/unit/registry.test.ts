/**
 * Registry unit tests (TC-11, TC-12, duplicate registration, testbox).
 */
import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import '../../tests/fixtures/testbox';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('object type registry', () => {
  it('TC-11: sticky spec is resizable, aspect-locked, minSize STICKY_MIN_SIZE_WORLD, editableText', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds and false one unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = {
      id: 'a',
      type: 'sticky' as const,
      x: 100,
      y: 100,
      color: 'yellow' as const,
      text: '',
      z: 1,
      createdAt: 1,
      width: 200,
      height: 200,
    };
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    expect(spec.hitTest(obj, { x: 299, y: 299 })).toBe(true);
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
  });

  it('TC-12: getObjectType for an unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null as never,
        resizable: false,
        aspectLocked: false,
        minSize: 0,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow();
  });

  it('testbox is registered: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
