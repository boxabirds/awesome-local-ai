/**
 * Story 7, sel.registry — registry lookups (TC-11, TC-12, duplicate
 * registration) and the test-only `testbox` type (used by the component
 * tests to prove the generic machinery is type-agnostic).
 */
import { describe, it, expect } from 'vitest';
import { getObjectType, registerObjectType } from 'src/client/objects/registry';
import { allObjectIds } from 'src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from 'src/shared/config';
// Importing the fixture registers the `testbox` type (module side effect).
import '../fixtures/testbox';

describe('object type registry', () => {
  it('TC-11: sticky is registered resizable, aspect-locked, minSize STICKY_MIN_SIZE_WORLD, editableText; hitTest inside true / 1 unit outside false (boundary)', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(spec!.Component).toBeTruthy();

    const note = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, width: 200, height: 200 };
    // Centre: inside.
    expect(spec!.hitTest(note, { x: 100, y: 100 })).toBe(true);
    // Exactly on the edge: inside (boundary is inclusive).
    expect(spec!.hitTest(note, { x: 200, y: 100 })).toBe(true);
    // One unit outside: false (boundary).
    expect(spec!.hitTest(note, { x: 201, y: 100 })).toBe(false);
    expect(spec!.hitTest(note, { x: 100, y: -1 })).toBe(false);
  });

  it('TC-12: getObjectType of an unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    // Story 10: 'shape' and 'connector' are registered object types (this
    // test originally used 'shape' as an example of an unregistered type).
    expect(getObjectType('shape')).toBeDefined();
    expect(getObjectType('connector')).toBeDefined();
    expect(getObjectType('pen')).toBeUndefined();
  });

  it('duplicate registration throws (programming error path)', () => {
    // `testbox` was registered by the fixture import; re-registering throws.
    expect(() => registerObjectType('testbox', getObjectType('testbox')!)).toThrow(
      'already registered',
    );
    // The original spec is still registered and retrievable.
    expect(getObjectType('testbox')).toBeDefined();
  });

  it('the test-only testbox type: resizable, NOT aspect-locked, minSize 10, retrievable', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
    // Registered types are selectable (allObjectIds) via board-model.
    expect(allObjectIds([{ id: 't', type: 'testbox', x: 0, y: 0, z: 1 }])).toEqual(['t']);
  });
});
