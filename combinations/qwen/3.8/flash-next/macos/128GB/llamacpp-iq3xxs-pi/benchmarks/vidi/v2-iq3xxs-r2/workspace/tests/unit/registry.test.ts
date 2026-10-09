import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  createSticky,
  initDoc,
  isObjectTypeKnown,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
// Registers the test-only type as a side effect, the way stories 9–12 will register their own.
import { TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';

/**
 * Story 7, `sel.registry`: what a type may declare about itself. Declarative data, so a
 * plain lookup is the whole test — the point is that the registry is the only place that
 * knows these things, and that a second type fits the same shape.
 */

function sticky(): ObjectSnapshot {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (typeof id !== 'string') throw new Error('fixture failed');
  const found = objectSnapshots(doc).find((object) => object.id === id);
  if (!found) throw new Error('fixture failed');
  return found;
}

describe('getObjectType (TC-11, TC-12)', () => {
  it('TC-11: declares sticky notes as resizable, ratio-kept, minimum 50 board units', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(spec?.Component).toBeTypeOf('function');
  });

  it('TC-11: a sticky note is hit inside its bounds and missed one unit outside', () => {
    const spec = getObjectType('sticky');
    if (!spec) throw new Error('sticky notes are not registered');
    const note = sticky();
    // Bounds are (-100, -100) to (100, 100) at 200 units.
    expect(spec.hitTest(note, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(note, { x: 99.5, y: -99.5 })).toBe(true);
    expect(spec.hitTest(note, { x: 100.5, y: 0 })).toBe(false);
    expect(spec.hitTest(note, { x: -100.5, y: 0 })).toBe(false);
    expect(spec.hitTest(note, { x: 0, y: 100.5 })).toBe(false);
  });

  it('TC-12: a type nobody registered has no spec, so it gets no handles either', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(isObjectTypeKnown('unknown')).toBe(false);
  });

  it('a test-only type fits the same shape, only with no ratio of its own', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec?.minSize).toBe(10);
    expect(spec?.editableText).toBe(false);
    // Registering a type is also what makes it selectable (TC-08's `known` flag).
    expect(isObjectTypeKnown(TESTBOX_TYPE)).toBe(true);
  });
});

describe('registerObjectType (duplicate registration)', () => {
  it('refuses to register the same type twice, loudly', () => {
    const spec = getObjectType('sticky');
    if (!spec) throw new Error('sticky notes are not registered');
    expect(() => registerObjectType('sticky', spec)).toThrow(/sticky/);
    // The refusal happened instead of the spec being replaced: TC-11 still holds.
    expect(getObjectType('sticky')).toBe(spec);
  });

  it('rejects a type name nothing can use', () => {
    const spec = getObjectType('sticky');
    if (!spec) throw new Error('sticky notes are not registered');
    expect(() => registerObjectType('', spec)).toThrow();
  });
});

describe('what the registry decides for a selection of mixed types', () => {
  it('offers each type its own minimum, which is what clampScale receives', () => {
    const note = sticky();
    const stickySpec = getObjectType('sticky');
    const boxSpec = getObjectType(TESTBOX_TYPE);
    if (!stickySpec || !boxSpec) throw new Error('types are not registered');
    const minSizes = [note.type, TESTBOX_TYPE].map((type) => {
      const spec = getObjectType(type);
      if (!spec) throw new Error(`${type} is not registered`);
      return spec.minSize;
    });
    expect(minSizes).toEqual([STICKY_MIN_SIZE_WORLD, TESTBOX_MIN_SIZE]);
    expect(STICKY_SIZE_WORLD / STICKY_MIN_SIZE_WORLD).toBe(4);
  });
});
