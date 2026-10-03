/**
 * Object type registry tests (`sel.registry`, TC-11, TC-12).
 *
 * The registry is the table that lets story 7's generic selection, move, resize
 * and delete code work on a board object without knowing what kind of object it
 * is. These tests cover the table's own rules; `tests/component/registry.test.tsx`
 * covers an object type reaching the screen through `<App>`, which needs a DOM.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { createSticky, objectBounds, snapshot } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  registerTestBox,
  TESTBOX_MIN_SIZE_WORLD,
  TESTBOX_TYPE,
  TestBox,
} from '../fixtures/testbox';

/** A component that does nothing, for the cases that do not need one. */
function Blank(_props: ObjectProps) {
  return null;
}

/** The one note of a fresh document, as the board sees it. */
function oneNote() {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  const note = snapshot(doc).find((item) => item.id === id)!;
  return { doc, id, note };
}

describe('the sticky note registration', () => {
  it('TC-11 describes the one type this build draws', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    // A note keeps its square shape when it is resized, and may not go below the
    // size its text is still readable at.
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('TC-11 hits a note anywhere inside its rectangle and nothing outside it', () => {
    const { note } = oneNote();
    const box = objectBounds(note);
    const spec = getObjectType('sticky')!;

    expect(spec.hitTest(note, { x: box.x + 1, y: box.y + 1 })).toBe(true);
    expect(spec.hitTest(note, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
    // Boundary: the corner itself is inside, one unit past each edge is not.
    expect(spec.hitTest(note, { x: box.x, y: box.y })).toBe(true);
    expect(spec.hitTest(note, { x: box.x + box.width, y: box.y + box.height })).toBe(true);
    expect(spec.hitTest(note, { x: box.x - 1, y: box.y })).toBe(false);
    expect(spec.hitTest(note, { x: box.x, y: box.y - 1 })).toBe(false);
    expect(spec.hitTest(note, { x: box.x + box.width + 1, y: box.y })).toBe(false);
    expect(spec.hitTest(note, { x: box.x, y: box.y + box.height + 1 })).toBe(false);
  });

  it('TC-12 registers the types this build draws, and no others', () => {
    // Story 10 registers `shape` and `connector`, so they are no longer unknown.
    expect(getObjectType('shape')).toBeDefined();
    expect(getObjectType('connector')).toBeDefined();
    // Story 12 gives `image` a component, so it is drawn, selected and resized here too.
    const image = getObjectType('image');
    expect(image).toBeDefined();
    // Resize keeps its proportions and stops at the smallest box worth showing
    // (`image.aspect_resize`), and there is nothing to type into a picture, so double-click
    // opens no editor.
    expect(image?.aspectLocked).toBe(true);
    expect(image?.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(image?.editableText).toBe(false);
    // A type nothing registers is still not drawn at all: the Pen draws strokes, which are their
    // own type, so a bare `pen` remains an object this build cannot show.
    expect(getObjectType('pen')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('is keyed by the exact string the document writes as the object type', () => {
    // The registry's keys, `obj.type` in the document and the ids selection holds
    // are one vocabulary; if they drift, lookups start missing silently.
    const { note, id } = oneNote();
    expect(note.type).toBe('sticky');
    expect(getObjectType(note.type)).toBeDefined();
    expect(note.id).toBe(id);
  });
});

describe('registering a type from outside the app', () => {
  it('TC-11 makes a foreign object type available to the generic code', () => {
    registerTestBox();

    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.Component).toBe(TestBox);
    expect(spec?.resizable).toBe(true);
    // Its own proportions and minimum, so the generic resize reads them from the
    // table instead of borrowing sticky note rules.
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(false);
  });

  it('fills in the defaults a type does not state', () => {
    registerObjectType('bare', { Component: Blank });

    const spec = getObjectType('bare')!;
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(false);
    expect(spec.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(false);
    // The default hit test is the object's own rectangle.
    const { note } = oneNote();
    expect(spec.hitTest(note, { x: note.x + 1, y: note.y + 1 })).toBe(true);
    expect(spec.hitTest(note, { x: note.x - 1, y: note.y })).toBe(false);
  });

  it('refuses to replace a type that is already registered, and leaves it alone', () => {
    registerObjectType('keepme', { Component: Blank, minSize: 42 });

    expect(() => registerObjectType('keepme', { Component: Blank, minSize: 999 })).toThrow(
      /keepme/,
    );
    // The first registration is what the board keeps drawing with.
    expect(getObjectType('keepme')!.minSize).toBe(42);
  });

  it('refuses to replace a real type with a test double', () => {
    expect(() => registerObjectType('sticky', { Component: Blank })).toThrow(/sticky/);
    expect(getObjectType('sticky')!.Component).not.toBe(Blank);
  });

  it('refuses a type name the document could never hold', () => {
    // A type name is an identifier written into the shared document, so a blank or
    // padded one is a bug at the point of registration, not a silent miss later.
    expect(() => registerObjectType('   ', { Component: Blank })).toThrow(/type name/i);
    expect(() => registerObjectType(' shaped ', { Component: Blank })).toThrow(/type name/i);
  });
});
