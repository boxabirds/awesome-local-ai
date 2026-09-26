import { describe, it, expect } from 'vitest';
import { registerObjectType, getObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('object registry', () => {
  it('TC-11: exposes the sticky spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.editableText).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-11: sticky hitTest is true inside bounds, false outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 100, height: 100 };
    expect(spec.hitTest(obj, { x: 50, y: 50 })).toBe(true);
    expect(spec.hitTest(obj, { x: 101, y: 50 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 0 })).toBe(false);
  });

  it('TC-12: returns undefined for an unknown type', () => {
    expect(getObjectType('no-such-type')).toBeUndefined();
  });

  it('TC-11: throws on duplicate registration', () => {
    const spec = { ...getObjectType('sticky')! };
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('allows registering a new type with its own metadata', () => {
    registerObjectType('unit-testbox', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (o, p) => p.x >= o.x && p.y >= o.y,
    });
    const spec = getObjectType('unit-testbox');
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(10);
  });
});
