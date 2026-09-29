// Story 7, contract `sel.registry` — unit tests TC-11, TC-12, duplicate
// registration, and the test-only type that proves the machinery is generic.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  getObjectType,
  registeredTypes,
  registerObjectType,
} from '../../src/client/objects/registry.tsx';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE, createTestBox } from '../fixtures/testbox.tsx';
import {
  initDoc,
  createSticky,
  objectBounds,
  objectSnapshots,
  BOARD_MODEL_TYPES,
} from '../../src/shared/board-model.ts';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config.ts';

function stickyAt(doc: Y.Doc) {
  createSticky(doc, { x: 100, y: 100 }); // centred → top-left (0, 0)
  return objectSnapshots(doc)[0]!;
}

describe('sel.registry', () => {
  it('TC-11 the sticky type is resizable, aspect-locked, editable and min-sized', () => {
    expect(BOARD_MODEL_TYPES.has('sticky')).toBe(true);
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect({
      resizable: spec!.resizable,
      aspectLocked: spec!.aspectLocked,
      minSize: spec!.minSize,
      editableText: spec!.editableText,
    }).toEqual({
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(typeof spec!.Component).toBe('function');
    expect(registeredTypes().has('sticky')).toBe(true);
  });

  it('TC-11b sticky hitTest is true inside its bounds and false one unit outside (boundary)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const obj = stickyAt(doc);
    expect(objectBounds(obj)).toEqual({
      x: 0,
      y: 0,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
    const spec = getObjectType('sticky')!;
    expect(spec.hitTest(obj, { x: 10, y: 10 })).toBe(true);
    expect(spec.hitTest(obj, { x: 199, y: 199 })).toBe(true); // just inside the corner
    expect(spec.hitTest(obj, { x: STICKY_SIZE_WORLD + 1, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
    expect(spec.hitTest(obj, { x: -1, y: 100 })).toBe(false);
  });

  it('TC-12 an unregistered type has no spec, so it is neither selectable nor resizable', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(registeredTypes().has('unknown')).toBe(false);
    // An object of that type in the document is not pulled in by select-all.
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const foreign = objectSnapshots(doc);
    expect(foreign.length).toBe(1);
  });

  it('registering the same type twice throws (two modules may not fight over one behaviour)', () => {
    const sticky = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', sticky)).toThrow(/already registered/);
    expect(() => registerObjectType('', sticky)).toThrow(/needs a name/);
    // The failed registrations changed nothing.
    expect(getObjectType('sticky')).toBe(sticky);
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect({
      resizable: spec!.resizable,
      aspectLocked: spec!.aspectLocked,
      minSize: spec!.minSize,
      editableText: spec!.editableText,
    }).toEqual({
      resizable: true,
      aspectLocked: false,
      minSize: TESTBOX_MIN_SIZE,
      editableText: false,
    });
    expect(typeof spec!.Component).toBe('function');
    // The fixture's creator produces an object of that type, at its own size,
    // and it is hit-testable like any other object.
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createTestBox(doc, 500, 400, 300, 150);
    const obj = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(obj.type).toBe(TESTBOX_TYPE);
    expect(objectBounds(obj)).toEqual({ x: 500, y: 400, width: 300, height: 150 });
    expect(spec!.hitTest(obj, { x: 501, y: 401 })).toBe(true);
    expect(spec!.hitTest(obj, { x: 801, y: 401 })).toBe(false);
    expect(registeredTypes().has(TESTBOX_TYPE)).toBe(true);
    // Both shipped and test types are known to the registry; a type nobody
    // registered is not (TC-12). When this test was written 'connector' was still a
    // future story's type; story 10 has registered it since, so the type that belongs
    // to nobody is a made-up name instead.
    expect(registeredTypes().has('sticky')).toBe(true);
    expect(getObjectType('unknown')).toBeUndefined();
  });
});
