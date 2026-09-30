import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { allObjectIds, createSticky, initDoc, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { createTestBox, registerTestBox, TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';

describe('object type registry (sel.registry)', () => {
  it('TC-11 sticky: resizable, aspect-locked, minSize STICKY_MIN_SIZE_WORLD, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({
      Component: StickyNote,
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 }); // top-left (0, 0)
    const note = snapshot(doc)[0];
    expect(spec!.hitTest(note, { x: 0, y: 0 })).toBe(true);
    expect(spec!.hitTest(note, { x: STICKY_SIZE_WORLD, y: STICKY_SIZE_WORLD })).toBe(true);
    expect(spec!.hitTest(note, { x: -1, y: 10 })).toBe(false); // boundary: 1 unit outside
    expect(spec!.hitTest(note, { x: 10, y: STICKY_SIZE_WORLD + 1 })).toBe(false);
  });

  it('TC-12 unknown type → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow(/already registered/);
  });

  it('the test-only testbox type is retrievable and becomes a readable model type', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const before = createTestBox(doc, { x: 0, y: 0, width: 100, height: 40 });
    expect(allObjectIds(objectsSnapshot(doc))).toEqual([]); // not registered yet → ignored
    registerTestBox();
    expect(getObjectType(TESTBOX_TYPE)).toMatchObject({ resizable: true, aspectLocked: false, minSize: TESTBOX_MIN_SIZE });
    expect(objectsSnapshot(doc)).toEqual([expect.objectContaining({ id: before, type: TESTBOX_TYPE, width: 100, height: 40 })]);
    expect(snapshot(doc)).toEqual([]); // not a sticky
  });
});
