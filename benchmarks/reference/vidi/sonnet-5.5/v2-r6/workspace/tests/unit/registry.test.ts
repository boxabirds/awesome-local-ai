import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { registerTestbox } from '../fixtures/testbox';
import type { ObjectSnapshot } from '../../src/shared/board-model';

const sticky = { id: 'a', type: 'sticky', x: 0, y: 0, width: 200, height: 200, z: 1 } as unknown as ObjectSnapshot;

describe('object type registry', () => {
  it('TC-11 sticky declares resizable, aspect-locked, min 50, editable text; hitTest edges', () => {
    const spec = getObjectType('sticky')!;
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true });
    expect(spec.hitTest(sticky, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(sticky, { x: 200, y: 200 })).toBe(true);
    expect(spec.hitTest(sticky, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(sticky, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12 an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('the test-only testbox type is retrievable (resizable, not aspect-locked, min 10)', () => {
    registerTestbox();
    expect(getObjectType('testbox')).toMatchObject({ resizable: true, aspectLocked: false, minSize: 10 });
  });
});
