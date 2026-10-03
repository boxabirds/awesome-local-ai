import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('object type registry (story 7)', () => {
  it('TC-11: the sticky type is registered with its resize rules', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true); // stickies stay square
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeDefined();
  });

  it('TC-11: the sticky hitTest uses its world bounds', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = {
      id: 'n1',
      type: 'sticky',
      x: 100,
      y: 100,
      z: 1,
      createdAt: 0,
      color: 'yellow',
      text: 'hi',
    };
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true); // left/top inclusive
    expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(false); // right/bottom exclusive
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
    // an explicit size is honoured
    expect(spec.hitTest({ ...obj, width: 50, height: 50 }, { x: 200, y: 120 })).toBe(false);
  });

  it('TC-11: unknown types are undefined', () => {
    expect(getObjectType('does-not-exist')).toBeUndefined();
  });

  it('TC-12: registering a type twice throws', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow(/already registered/);
  });

  it('TC-12: a new type can be registered and looked up (stories 9–12 contract)', () => {
    registerObjectType('testbox-unique', {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    });
    expect(getObjectType('testbox-unique')?.resizable).toBe(false);
    expect(STICKY_SIZE_WORLD).toBe(200);
  });
});
