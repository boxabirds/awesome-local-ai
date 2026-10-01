import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType, defaultHitTest } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

// Ensure sticky is registered (import side effect)
import '../../src/client/objects/registerSticky';

describe('registry: getObjectType sticky', () => {
  it('TC-11: sticky spec has correct properties', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11b: sticky hitTest is true inside bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = { id: 'x', type: 'sticky', x: 100, y: 100, z: 1 };
    // Inside (default size 200)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // On the boundary (edge counts as inside)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
    // 1 unit outside
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 99 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
  });
});

describe('registry: unknown types', () => {
  it('TC-12: getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });
});

describe('registry: duplicate registration', () => {
  it('duplicate registerObjectType throws', () => {
    registerObjectType('test-dupe', {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: defaultHitTest,
    });
    expect(() =>
      registerObjectType('test-dupe', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: defaultHitTest,
      }),
    ).toThrow();
  });
});

describe('registry: testbox type', () => {
  it('testbox is registered as resizable, not aspect-locked, minSize 10', () => {
    registerObjectType('testbox', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: defaultHitTest,
    });
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
