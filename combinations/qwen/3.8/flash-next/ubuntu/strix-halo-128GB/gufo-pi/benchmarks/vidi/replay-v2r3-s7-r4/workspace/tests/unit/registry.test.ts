import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE } from '../fixtures/testbox';

function stickyAt(x: number, y: number, width = 200, height = 200): ObjectSnapshot {
  return {
    id: 's1',
    type: 'sticky',
    x,
    y,
    width,
    height,
    color: 'yellow',
    text: '',
    z: 1,
    createdAt: 0,
  };
}

describe('object type registry', () => {
  it('TC-11 sticky spec: resizable, aspect-locked, min size STICKY_MIN_SIZE_WORLD, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');
  });

  it('TC-11 sticky hitTest is true inside bounds and false one unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const obj = stickyAt(0, 0, 200, 200);
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 200, y: 200 })).toBe(true); // on the edge
    expect(spec.hitTest(obj, { x: 201, y: 100 })).toBe(false); // 1 unit outside
    expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12 getObjectType for an unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow();
  });

  it('the test-only testbox type is retrievable and not aspect-locked', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
  });
});
