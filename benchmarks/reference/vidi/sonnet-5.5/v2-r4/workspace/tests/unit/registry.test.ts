import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { boundsHitTest, getObjectType, registerObjectType } from '../../src/client/objects/registry';

const sticky: ObjectSnapshot = { id: 'a', type: 'sticky', x: 0, y: 0, width: 200, height: 200, z: 1, createdAt: 0 };

describe('object registry', () => {
  it('TC-11 sticky declares its resize rules and hit-tests its bounds', () => {
    const spec = getObjectType('sticky')!;
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true });
    expect(spec.hitTest(sticky, { x: 200, y: 100 })).toBe(true);
    expect(spec.hitTest(sticky, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(sticky, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12 an unknown type is not registered', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow(/already registered/);
  });

  it('a new type can be registered and retrieved', () => {
    const spec = { ...getObjectType('sticky')!, resizable: true, aspectLocked: false, minSize: 10, hitTest: boundsHitTest };
    registerObjectType('registry-test-type', spec);
    expect(getObjectType('registry-test-type')).toBe(spec);
  });
});
