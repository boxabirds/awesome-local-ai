/**
 * Unit tests for the object type registry (`sel.registry`, TC-11 and TC-12).
 *
 * The registry is where "every object type behaves the same" either is or isn't true,
 * so the settings each type declares are checked here as facts, and the difference
 * between the two types the board knows is checked directly: a sticky note keeps its
 * proportions, a testbox does not, and everything the board does with a selection reads
 * those two answers rather than knowing about either of them.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  describeSelection,
  getObjectType,
  hitTestObject,
  registerObjectType,
  registeredObjectTypes,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { initDoc, snapshot } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import {
  TESTBOX_MIN_SIZE_WORLD,
  TESTBOX_TYPE,
  TestBox,
  createTestbox,
} from '../fixtures/testbox';

/** An object of some other type, as the board would report it. */
function object(overrides: Partial<ObjectSnapshot> = {}): ObjectSnapshot {
  return {
    id: 'object-1',
    type: 'sticky',
    x: 0,
    y: 0,
    z: 1,
    createdAt: 1_700_000_000_000,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    ...overrides,
  };
}

const blankComponent = (): null => null;

describe('registry.sticky', () => {
  it('TC-11: declares a sticky note resizable, square, and typed into', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(spec?.Component).toBeDefined();
  });

  it('TC-11a: hits a point inside a note, and not one outside it', () => {
    const spec = getObjectType('sticky')!;
    const note = object({ x: 100, y: 200, width: 400, height: 300 });

    expect(spec.hitTest(note, { x: 300, y: 300 })).toBe(true);
    // The edges belong to the note: a point exactly on its border is on it.
    expect(spec.hitTest(note, { x: 100, y: 200 })).toBe(true);
    expect(spec.hitTest(note, { x: 500, y: 500 })).toBe(true);
    expect(spec.hitTest(note, { x: 99.9, y: 300 })).toBe(false);
    expect(spec.hitTest(note, { x: 300, y: 500.1 })).toBe(false);
    // The same answer through the type-blind entry point.
    expect(hitTestObject(note, { x: 300, y: 300 })).toBe(true);
    expect(hitTestObject(note, { x: 0, y: 0 })).toBe(false);
  });

  it('reports the size a note of a board that stores no sizes occupies', () => {
    // A note drawn from a document written before story 7 is still a square of the
    // right size for the type's hit test and for the resize limits.
    expect(object({}).width).toBe(STICKY_SIZE_WORLD);
    expect(getObjectType('sticky')!.hitTest(object({}), { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 })).toBe(true);
  });
});

describe('registry.registerObjectType', () => {
  it('TC-12: refuses to register the same type twice', () => {
    const type = `type-${Math.random().toString(36).slice(2)}`;
    const spec = {
      Component: blankComponent,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    };

    expect(() => registerObjectType(type, spec)).not.toThrow();
    expect(() => registerObjectType(type, spec)).toThrow(/already registered/);
    // The type that is in there is still described the way it was first told.
    expect(getObjectType(type)).toBe(spec);
    expect(registeredObjectTypes()).toContain(type);
  });

  it('refuses a type with no name, and knows nothing about one that was never told', () => {
    expect(() => registerObjectType('', { ...getObjectType('sticky')! })).toThrow();
    expect(getObjectType('spaceship')).toBeUndefined();
    expect(hitTestObject(object({ type: 'spaceship' }), { x: 1, y: 1 })).toBe(false);
  });

  it('TC-24a: a second type is registered and read back with its own settings', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    // The one thing that must differ from a sticky note, so a test of the resize rules
    // can tell the type's rule from the board's.
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec?.minSize).not.toBe(getObjectType('sticky')!.minSize);
    expect(spec?.editableText).toBe(false);
  });

  it('tells the document model about a type, so its objects can be selected at all', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const spec = getObjectType(TESTBOX_TYPE)!;
    // The component a type is drawn with is the one registered, not a copy.
    expect(spec.Component).toBe(TestBox);

    createTestbox(doc, { id: 'box-1', x: 20, y: 30, width: 120, height: 80 });
    // Registered types are reported by the snapshot; an unknown type is not, and so
    // cannot be moved, resized or deleted by this build.
    expect(snapshot(doc).map((object) => object.type)).toEqual([TESTBOX_TYPE]);
    expect(hitTestObject(snapshot(doc)[0]!, { x: 25, y: 35 })).toBe(true);
    expect(hitTestObject(snapshot(doc)[0]!, { x: 19, y: 29 })).toBe(false);
  });
});

describe('registry.describeSelection', () => {
  it('offers no handles for a group that contains something that cannot be resized', () => {
    const fixed = `fixed-${Math.random().toString(36).slice(2)}`;
    registerObjectType(fixed, {
      Component: blankComponent,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => true,
    });

    expect(describeSelection([object({})]).resizable).toBe(true);
    expect(describeSelection([object({}), object({ id: 'x', type: fixed })]).resizable).toBe(false);
    // Nothing selected is nothing to resize.
    expect(describeSelection([]).resizable).toBe(false);
  });

  it('locks the proportions for a group that contains anything that keeps them', () => {
    const note = object({});
    const box = object({ id: 'box', type: TESTBOX_TYPE });

    expect(describeSelection([box]).aspectLocked).toBe(false);
    expect(describeSelection([note]).aspectLocked).toBe(true);
    expect(describeSelection([box, note]).aspectLocked).toBe(true);
    expect(describeSelection([box, box]).aspectLocked).toBe(false);
  });

  it('gives every object its own minimum, in the order it was asked about', () => {
    const note = object({});
    const box = object({ id: 'box', type: TESTBOX_TYPE });

    expect(describeSelection([note, box]).minSizes).toEqual([STICKY_MIN_SIZE_WORLD, TESTBOX_MIN_SIZE_WORLD]);
    expect(describeSelection([box, note]).minSizes).toEqual([TESTBOX_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD]);
    // A type the board cannot describe is not offered for resize.
    expect(describeSelection([object({ type: 'spaceship' })]).resizable).toBe(false);
    expect(describeSelection([object({ type: 'spaceship' })]).minSizes).toEqual([STICKY_SIZE_WORLD]);
  });

  it('says whether the group has any text to edit', () => {
    const box = object({ id: 'box', type: TESTBOX_TYPE });

    expect(describeSelection([object({})]).editableText).toBe(true);
    expect(describeSelection([box]).editableText).toBe(false);
    expect(describeSelection([box, object({ id: 'n' })]).editableText).toBe(true);
  });
});
