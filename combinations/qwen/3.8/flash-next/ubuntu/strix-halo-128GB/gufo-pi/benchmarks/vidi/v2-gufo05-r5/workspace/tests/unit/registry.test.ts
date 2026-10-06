/**
 * Registry unit tests (TC-11, TC-12, duplicate registration).
 */
import { describe, expect, test } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ConnectorSnapshot } from '../../src/shared/board-model';

describe('registry', () => {
  // TC-11: getObjectType('sticky') has correct spec
  test('TC-11: sticky spec is correct', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  test('TC-11: sticky hitTest is true inside bounds and false outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 100, y: 100, color: 'yellow' as const, text: '', z: 1, createdAt: 0 };
    // Inside the 200×200 bounds (default STICKY_SIZE_WORLD)
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // 1 unit outside (right edge is at 300)
    expect(spec.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    // 1 unit outside (bottom edge is at 300)
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
    // Exactly on edge is inside (inclusive)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 299, y: 299 })).toBe(true);
  });

  // Story 10: a shape is a box like any other, and an arrow is the one object that is not.
  test('story 10: the shape registration is a resizable box with an editable label', () => {
    const spec = getObjectType('shape');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.handles).toBeUndefined(); // 'all' is the default, and a shape wants all of them
  });

  test('story 10: the connector registration offers nothing to resize and answers on the line only', () => {
    const spec = getObjectType('connector');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(false);
    expect(spec!.editableText).toBe(false);
    expect(spec!.handles).toBe('none');

    // An arrow across a box: the middle of the line is a hit, and the empty corner of the box the
    // line occupies belongs to the board, not to the arrow.
    const from = { x: -100, y: -100 };
    const to = { x: 100, y: 100 };
    const arrow: ConnectorSnapshot = {
      id: 'arrow',
      type: 'connector',
      x: from.x,
      y: from.y,
      width: to.x - from.x,
      height: to.y - from.y,
      z: 1,
      createdAt: 0,
      createdBy: 'local',
      from: { kind: 'free', x: from.x, y: from.y },
      to: { kind: 'free', x: to.x, y: to.y },
      ends: { from, to },
    };
    expect(spec!.hitTest(arrow, { x: 0, y: 0 })).toBe(true);
    expect(spec!.hitTest(arrow, { x: 1, y: -1 })).toBe(true);
    expect(spec!.hitTest(arrow, { x: -100, y: 100 })).toBe(false);
  });

  // TC-12: unknown type returns undefined
  test('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  // Duplicate registration throws
  test('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {} as ObjectTypeSpec);
    }).toThrow();
  });
});
