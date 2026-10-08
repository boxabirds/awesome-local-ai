import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

describe('registry', () => {
  // TC-11: getObjectType('sticky') returns expected spec
  it('TC-11: sticky spec has correct properties', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest is true inside bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj: ObjectSnapshot = { id: 'test', type: 'sticky', x: 100, y: 100, z: 1, width: 200, height: 200 };
    // Inside: point (150, 150) is within (100,100)-(300,300)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // Boundary: point on edge (100, 100) should be inside
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // Outside: point (99, 99) is just outside top-left
    expect(spec.hitTest(obj, { x: 99, y: 99 })).toBe(false);
  });

  // TC-12: getObjectType('unknown') → undefined
  it('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    // 'shape' and 'connector' were story 7's example of an unregistered type; story 10
    // registered them, so the example is a type no story has reached yet (story 12's
    // image), which is what this test has always meant.
    expect(getObjectType('image')).toBeUndefined();
  });

  // Story 10: shapes and connectors register with the knobs the generic selection
  // machinery needs (design: registry entries).
  it('story 10: shape and connector specs have the documented properties', () => {
    const shape = getObjectType('shape');
    expect(shape).toBeDefined();
    expect(shape!.resizable).toBe(true);
    expect(shape!.aspectLocked).toBe(false);
    expect(shape!.minSize).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape!.editableText).toBe(true);

    const connector = getObjectType('connector');
    expect(connector).toBeDefined();
    // Where an arrow goes is decided by its ends, so it offers no resize handles.
    expect(connector!.resizable).toBe(false);
    expect(connector!.editableText).toBe(false);

    const arrow = {
      id: 'c1',
      type: 'connector',
      x: 0,
      y: 0,
      z: 1,
      width: 100,
      height: 0,
      ends: { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
    } as unknown as ObjectSnapshot;
    // On the line at 100% zoom (tolerance 6 board units), off it by 10 units, and — at
    // 10x zoom, where 6 screen pixels is 0.6 board units — the same *screen* distance
    // from the line is still a hit and 10 screen pixels away is not (TC-20).
    expect(connector!.hitTest(arrow, { x: 50, y: 3 }, 1)).toBe(true);
    expect(connector!.hitTest(arrow, { x: 50, y: 10 }, 1)).toBe(false);
    expect(connector!.hitTest(arrow, { x: 50, y: 0.5 }, 10)).toBe(true);
    expect(connector!.hitTest(arrow, { x: 50, y: 1 }, 10)).toBe(false);
  });

  // Duplicate registration throws
  it('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 0,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow();
  });

  // Test-only testbox type
  it('testbox type can be registered and retrieved', () => {
    // Register testbox for use in component tests
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
