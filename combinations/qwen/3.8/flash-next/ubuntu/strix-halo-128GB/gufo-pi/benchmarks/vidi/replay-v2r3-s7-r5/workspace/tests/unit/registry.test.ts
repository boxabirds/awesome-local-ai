import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('registry (TC-11, TC-12)', () => {
  it('TC-11: getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest returns true inside bounds', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'test',
      type: 'sticky',
      x: 100,
      y: 100,
      color: 'yellow',
      text: '',
      z: 1,
      createdAt: 0,
    };
    // Center of the note
    expect(spec.hitTest(obj, { x: 100 + STICKY_SIZE_WORLD / 2, y: 100 + STICKY_SIZE_WORLD / 2 })).toBe(true);
    // Top-left corner (boundary)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // Bottom-right corner (boundary)
    expect(spec.hitTest(obj, { x: 100 + STICKY_SIZE_WORLD, y: 100 + STICKY_SIZE_WORLD })).toBe(true);
  });

  it('TC-11: sticky hitTest returns false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'test',
      type: 'sticky',
      x: 100,
      y: 100,
      color: 'yellow',
      text: '',
      z: 1,
      createdAt: 0,
    };
    // 1 unit to the left
    expect(spec.hitTest(obj, { x: 99, y: 200 })).toBe(false);
    // 1 unit above
    expect(spec.hitTest(obj, { x: 200, y: 99 })).toBe(false);
    // 1 unit to the right
    expect(spec.hitTest(obj, { x: 100 + STICKY_SIZE_WORLD + 1, y: 200 })).toBe(false);
    // 1 unit below
    expect(spec.hitTest(obj, { x: 200, y: 100 + STICKY_SIZE_WORLD + 1 })).toBe(false);
  });

  it('TC-12: getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow(/already registered/);
  });

  it('testbox type is registerable and retrievable', () => {
    registerObjectType('testbox', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    });
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
