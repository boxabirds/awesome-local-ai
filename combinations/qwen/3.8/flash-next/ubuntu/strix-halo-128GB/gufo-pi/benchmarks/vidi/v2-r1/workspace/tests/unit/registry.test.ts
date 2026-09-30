import { describe, expect, it } from 'vitest';

import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('registry getObjectType', () => {
  it('TC-11 getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11 hitTest is true inside bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky', x: 100, y: 100, z: 1, width: 200, height: 200 };
    // Inside
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // On the edge (inclusive)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
    // 1 unit outside
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 99 })).toBe(false);
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
  });

  it('TC-12 getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registerObjectType throws', () => {
    expect(() => registerObjectType('sticky', {} as any)).toThrow();
  });
});
