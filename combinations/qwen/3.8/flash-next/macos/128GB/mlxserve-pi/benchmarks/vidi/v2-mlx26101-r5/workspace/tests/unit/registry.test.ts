/**
 * Unit tests for the object-type registry (design capability `obj.registry`, TC-11 and TC-12, plus
 * the rules the design leaves to the implementation).
 *
 * The registry is the one place that knows what can be put on a board. It is a plain module map, so
 * these are ordinary unit tests; the rendering half of TC-12 — a board that holds an object this
 * client cannot draw — is in `tests/component/ObjectRendering.test.tsx`, because it needs a board to
 * look at.
 *
 * One thing to know before reading: a type cannot be taken back out of the registry, so the fixture
 * type is registered once for this whole file, the way a story's type is registered once for the
 * whole page. Vitest gives every test file its own copy of the modules, which is what makes that
 * safe to do here and nowhere else.
 */

import { describe, expect, it } from 'vitest';

import {
  getObjectType,
  hasEditableText,
  hitTestObject,
  isResizableType,
  keepsAspect,
  minSizeWorld,
  registerObjectType,
  registeredObjectTypes,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { objectBounds, type ObjectSnapshot, type StickySnapshot } from '../../src/shared/board-model';
import {
  registerTestBox,
  TESTBOX_MIN_SIZE_WORLD,
  TESTBOX_TYPE,
} from '../fixtures/testbox';

// The fixture type, for the tests below that need a second one. Registered here rather than in each
// test because there is no unregistering it, and a file that needs two types says so at the top.
registerTestBox();

describe('TC-11 the sticky note is a registered object type', () => {
  it('has a definition with a component, a minimum size and its proportions', () => {
    const spec = getObjectType('sticky');
    expect(spec).not.toBeUndefined();
    expect(typeof spec?.Component).toBe('function');
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.resizable).toBe(true);
    expect(spec?.editableText).toBe(true);
  });

  it('is in the list of types this build can draw', () => {
    expect(registeredObjectTypes()).toContain('sticky');
  });

  it('is asked for its limits by type, which is what a mixed resize needs', () => {
    expect(minSizeWorld('sticky')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(keepsAspect('sticky')).toBe(true);
    expect(isResizableType('sticky')).toBe(true);
    expect(hasEditableText('sticky')).toBe(true);
  });

  it('is where its own bounds say it is, and nowhere else', () => {
    const note: StickySnapshot = {
      id: 'note-1',
      type: 'sticky',
      x: 100,
      y: 200,
      width: 200,
      height: 200,
      z: 1,
      createdAt: 0,
      color: 'yellow',
      text: '',
    };
    expect(hitTestObject(note, { x: 101, y: 201 })).toBe(true);
    expect(hitTestObject(note, { x: 299.5, y: 399.5 })).toBe(true);
    // One unit past the edge is not on the note: a marquee and a pointer agree with the box.
    expect(hitTestObject(note, { x: 301, y: 300 })).toBe(false);
    expect(hitTestObject(note, { x: 99, y: 300 })).toBe(false);
  });
});

describe('TC-12 a type this build does not know is missing, not broken', () => {
  it('has no definition', () => {
    expect(getObjectType('mystery')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  it('still has a minimum size, so a board that holds one can be resized around it', () => {
    // The size every object of an unknown type was born with is the only size that cannot be wrong.
    expect(minSizeWorld('mystery')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(keepsAspect('mystery')).toBe(false);
    // It cannot be resized, because nothing here can draw the result.
    expect(isResizableType('mystery')).toBe(false);
    expect(hasEditableText('mystery')).toBe(false);
  });

  it('is nowhere: it cannot be picked up by a marquee or a pointer', () => {
    const unknown: ObjectSnapshot = {
      id: 'legacy-1',
      type: 'drawing',
      x: 0,
      y: 0,
      z: 4,
      createdAt: 0,
    };
    expect(hitTestObject(unknown, { x: 0, y: 0 })).toBe(false);
    expect(hitTestObject(unknown, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 })).toBe(false);
    // …but it does have a box, which is what a group's bounding box is built out of.
    expect(objectBounds(unknown)).toEqual({ x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
  });

  it('is not in the list of types that can be drawn', () => {
    expect(registeredObjectTypes()).not.toContain('mystery');
  });
});

describe('registering a type twice', () => {
  it('is a programming error and throws, rather than quietly drawing the wrong thing', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => true,
      }),
    ).toThrow(/sticky/);
    // The first definition is still the one in use.
    expect(getObjectType('sticky')?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('says which one it was looking at', () => {
    let message = '';
    try {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => true,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('already registered');
  });

  it('leaves the definition that was there, which is what the throw is for', () => {
    expect(() => registerTestBox).not.toThrow();
    expect(minSizeWorld(TESTBOX_TYPE)).toBe(TESTBOX_MIN_SIZE_WORLD);
  });
});

describe('a fixture object type', () => {
  it('is a full definition with its own limits', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).not.toBeUndefined();
    expect(typeof spec?.Component).toBe('function');
    expect(minSizeWorld(TESTBOX_TYPE)).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(registeredObjectTypes()).toContain(TESTBOX_TYPE);
  });

  it('is resizable but does not keep its proportions, and has nothing to type into', () => {
    // Each of the three switches in the opposite position to the sticky note's, so a group resize
    // that reads them per object is tested with them actually differing.
    expect(isResizableType(TESTBOX_TYPE)).toBe(true);
    expect(keepsAspect(TESTBOX_TYPE)).toBe(false);
    expect(hasEditableText(TESTBOX_TYPE)).toBe(false);
  });

  it('is somewhere, on its own say-so', () => {
    const box: ObjectSnapshot = {
      id: 'box-1',
      type: TESTBOX_TYPE,
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      z: 2,
      createdAt: 0,
    };
    expect(hitTestObject(box, { x: 11, y: 21 })).toBe(true);
    expect(hitTestObject(box, { x: 109, y: 79 })).toBe(true);
    expect(hitTestObject(box, { x: 111, y: 80 })).toBe(false);
  });

  it('does not disturb the sticky note, which is the point of a list rather than a global', () => {
    expect(getObjectType('sticky')).not.toBeUndefined();
    expect(minSizeWorld('sticky')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(keepsAspect('sticky')).toBe(true);
  });
});
