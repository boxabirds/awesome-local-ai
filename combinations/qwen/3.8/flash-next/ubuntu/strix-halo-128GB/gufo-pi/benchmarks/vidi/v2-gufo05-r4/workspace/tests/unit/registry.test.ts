/**
 * Story 7 unit tests: the client object type registry (`sel.registry`).
 *
 * The registry is the whole of what a later story is allowed to say about its object
 * type — resizable or not, proportions kept or not, how small, editable text or not, and
 * how to hit-test it — so what is tested here is that those declarations are the ones the
 * generic layer reads, that an unknown type is *absent* rather than half-known, and that
 * registering the same name twice is a loud programming error.
 */

import { describe, expect, it } from 'vitest';
import { allObjectIds, type ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  getObjectType,
  hitTestBounds,
  isAspectLocked,
  isResizable,
  minSizeOf,
  registerObjectType,
  registeredTypes,
  selectionIsAspectLocked,
  selectionIsResizable
} from '../../src/client/objects/registry';
// Importing the board's own type list registers `sticky`.
import '../../src/client/objects';
import { TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';

describe('object type registry (sel.registry)', () => {
  it('TC-11: sticky notes declare themselves resizable, aspect-locked and 50 units at smallest', () => {
    const sticky = getObjectType('sticky');
    expect(sticky).toBeDefined();
    expect(sticky?.resizable).toBe(true);
    expect(sticky?.aspectLocked).toBe(true);
    expect(sticky?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(sticky?.editableText).toBe(true);
    expect(typeof sticky?.hitTest).toBe('function');
    expect(typeof sticky?.Component).toBe('function');
  });

  it('TC-12: a type this build does not know has no spec at all', () => {
    expect(getObjectType('whiteboard-shape-from-2030')).toBeUndefined();
    // Absent, not "known and inert": a type with no spec is neither resizable nor locked.
    expect(isResizable('whiteboard-shape-from-2030')).toBe(false);
    expect(isAspectLocked('whiteboard-shape-from-2030')).toBe(false);
  });

  it('a second registration of the same type throws rather than quietly winning', () => {
    registerObjectType('temp-shape', {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: hitTestBounds
    });
    expect(() =>
      registerObjectType('temp-shape', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: hitTestBounds
      })
    ).toThrow(/temp-shape/);
    expect(registeredTypes()).toContain('temp-shape');
  });

  it('a type with no name, or no component, is refused', () => {
    const spec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: hitTestBounds
    };
    expect(() => registerObjectType('', spec)).toThrow(/type name/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => registerObjectType('nameless', { ...spec, Component: undefined as any })).toThrow(/component/);
  });

  it('the test fixture declares a type with its own minimum and no aspect lock', () => {
    const box = getObjectType(TESTBOX_TYPE);
    expect(box?.resizable).toBe(true);
    expect(box?.aspectLocked).toBe(false);
    expect(box?.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(box?.editableText).toBe(false);
    expect(TESTBOX_MIN_SIZE).not.toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('the default hit test answers inside a note and outside it', () => {
    const note: ObjectSnapshot = { id: 'a', type: 'sticky', x: 100, y: 100, z: 1, width: 200, height: 200 };
    expect(hitTestBounds(note, { x: 150, y: 150 })).toBe(true);
    expect(hitTestBounds(note, { x: 301, y: 150 })).toBe(false);
    expect(hitTestBounds(note, { x: Number.NaN, y: 0 })).toBe(false);
  });

  it('a selection shows handles if any of its types can be resized, and locks if any must', () => {
    expect(selectionIsResizable(['sticky'])).toBe(true);
    expect(selectionIsResizable([TESTBOX_TYPE])).toBe(true);
    expect(selectionIsResizable(['unknown'])).toBe(false);
    expect(selectionIsResizable([])).toBe(false);
    expect(selectionIsAspectLocked([TESTBOX_TYPE, 'sticky'])).toBe(true);
    expect(selectionIsAspectLocked([TESTBOX_TYPE])).toBe(false);
  });

  it('an unknown minimum falls back to 1 rather than to no limit', () => {
    expect(minSizeOf('sticky')).toBe(STICKY_MIN_SIZE_WORLD);
    expect(minSizeOf('unknown')).toBe(1);
  });

  it('registering a type is what lets the document model list its objects', () => {
    // A declared type is listable and an unknown one is not; TC-08 in
    // `board-model-group.test.ts` is the same rule read off a real document.
    expect(allObjectIds([{ id: 'known', type: TESTBOX_TYPE, x: 0, y: 0, z: 1 }])).toEqual(['known']);
    expect(allObjectIds([{ id: 'ghost', type: 'not-registered-here', x: 0, y: 0, z: 1 }])).toEqual([]);
  });
});
