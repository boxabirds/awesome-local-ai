import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import '../fixtures/testbox';

const obj = (x: number, y: number): ObjectSnapshot => ({ id: 'a', type: 'sticky', x, y, z: 1, createdAt: 0 });

describe('object type registry (sel.registry)', () => {
  it('TC-11 sticky spec', () => {
    const spec = getObjectType('sticky')!;
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true });
    const o = obj(0, 0); // 200x200
    expect(spec.hitTest(o, { x: 200, y: 200 })).toBe(true);
    expect(spec.hitTest(o, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(o, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12 unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow();
  });

  it('test-only testbox is resizable, not aspect locked, min 10', () => {
    expect(getObjectType('testbox')).toMatchObject({ resizable: true, aspectLocked: false, minSize: 10 });
  });
});
