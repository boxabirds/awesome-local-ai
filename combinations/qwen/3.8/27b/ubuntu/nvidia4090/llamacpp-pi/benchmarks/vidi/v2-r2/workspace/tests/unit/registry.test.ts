/**
 * Story 7: object type registry unit tests (TC-11, TC-12, duplicate
 * registration, test-only testbox type).
 */

import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

// Side-effect import: registers the test-only 'testbox' type.
import '../fixtures/testbox';

describe('registry (sel.registry)', () => {
  it('TC-11: sticky spec and hitTest boundary', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.hitTest).toBe('function');

    // A 200×200 sticky at top-left (0,0): inside at the centre, and inside
    // up to (but not including) the far edges...
    const note: ObjectSnapshot = { id: 'n', type: 'sticky', x: 0, y: 0, z: 0, createdAt: 0 };
    expect(spec!.hitTest(note, { x: 100, y: 100 }, 1)).toBe(true);
    expect(spec!.hitTest(note, { x: 1, y: 1 }, 1)).toBe(true);
    // ...exactly on the far edge is OUTSIDE (boundary), and 1 unit beyond it
    // is outside too.
    expect(spec!.hitTest(note, { x: 200, y: 100 }, 1)).toBe(false);
    expect(spec!.hitTest(note, { x: 201, y: 100 }, 1)).toBe(false);
    expect(spec!.hitTest(note, { x: 100, y: 201 }, 1)).toBe(false);
  });

  it('TC-12: unknown type → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    expect(() => registerObjectType('sticky', {
      Component: () => null as never,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    })).toThrow();
  });

  it('test-only testbox type is registered and retrievable', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
  });
});
