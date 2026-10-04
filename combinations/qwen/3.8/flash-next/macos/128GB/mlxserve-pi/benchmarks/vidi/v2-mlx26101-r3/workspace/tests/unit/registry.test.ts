import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  OBJECTS_MAP,
  STICKY_TYPE,
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  getObjectType,
  registerObjectType,
  registeredObjectTypes,
} from '../../src/client/objects/registry';

/**
 * Object registry unit tests (TC-11, TC-12, and the duplicate registration the design asks for).
 *
 * The registry is the seam every object type - sticky notes now, shapes and arrows in stories 8
 * and 12 - is looked up through, so what matters here is that the lookup answers for the types
 * that exist, says "no" plainly for the ones that do not, and refuses to let two types claim the
 * same name. It runs in node: a registry is data, and the components it points at are only
 * reached once something is actually drawn.
 */

/** A component is anything React would take; a named marker function is enough to spot it. */
function probe(name: string): () => null {
  const component = (): null => null;
  Object.defineProperty(component, 'name', { value: name });
  return component;
}

/** A shape written into the document by somebody whose board knows something ours does not. */
function insertRaw(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) {
      object.set(key, value);
    }
    doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).set(id, object);
  });
}

function spec(overrides: Partial<{ minSize: number; resizable: boolean }> = {}) {
  return {
    Component: probe('Widget'),
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: () => true,
    ...overrides,
  };
}

describe('objects.registry (sel.object_registry)', () => {
  it('TC-11 knows the sticky note, by name, with everything the board needs to draw it', () => {
    const types = registeredObjectTypes();
    expect(types).toContain(STICKY_TYPE);
    const sticky = getObjectType(STICKY_TYPE);
    expect(sticky).toBeDefined();
    expect(typeof sticky!.Component).toBe('function');
    expect(sticky!.resizable).toBe(true);
    expect(sticky!.aspectLocked).toBe(true);
    expect(sticky!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(sticky!.editableText).toBe(true);
    // The maximum is a global setting rather than something a type declares, so a new type
    // cannot quietly decide its own ceiling.
    expect(MAX_OBJECT_SIZE_WORLD).toBeGreaterThan(sticky!.minSize);
  });

  it('TC-12 has no component for an object written by a newer board (negative)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    insertRaw(doc, 'diamond-1', { type: 'diamond', x: 0, y: 0, width: 40, height: 40, z: 1 });
    // The object is in the document, and the lookup for its type is empty: not a guess, not a
    // default, nothing drawn.
    expect(doc.getMap(OBJECTS_MAP).has('diamond-1')).toBe(true);
    expect(getObjectType('diamond')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
    expect(registeredObjectTypes()).not.toContain('diamond');
    // The board model agrees: an object with no component of its own never reaches the snapshot
    // the board iterates over, so nothing asks for a component that is not there.
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11b looks a note up by the type name it carries in the document', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const objects = snapshot(doc);
    expect(objects).toHaveLength(1);
    const found = getObjectType(objects[0]!.type);
    expect(found).toBe(getObjectType(STICKY_TYPE));
    expect(found?.resizable).toBe(true);
    expect(found?.editableText).toBe(true);
  });

  it('TC-11c hit-tests a box the way the marquee and the overlay need it done', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 });
    const note = snapshot(doc).find((object) => object.id === id)!;
    const sticky = getObjectType(STICKY_TYPE)!;
    expect(note).toMatchObject({ x: 200, y: 200, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD });
    expect(sticky.hitTest(note, { x: 300, y: 300 })).toBe(true);
    expect(sticky.hitTest(note, { x: 200, y: 200 })).toBe(true); // corner (boundary)
    expect(sticky.hitTest(note, { x: 199.9, y: 300 })).toBe(false);
    expect(sticky.hitTest(note, { x: 300, y: 400.1 })).toBe(false);
  });

  it('TC-11d refuses to let two types be called the same thing (error path)', () => {
    const name = 'unit-registered-once';
    registerObjectType(name, { ...spec(), Component: probe('Once') });
    expect(() => registerObjectType(name, { ...spec(), Component: probe('Twice') })).toThrow(name);
    // The first one is still the one that gets drawn: a bad registration changes nothing.
    expect(getObjectType(name)?.Component.name).toBe('Once');
    expect(registeredObjectTypes().filter((type) => type === name)).toHaveLength(1);
  });

  it('TC-11e takes a type the board has never seen and asks it in the same way', () => {
    const name = 'unit-registered-sticker';
    const Component = probe('Sticker');
    registerObjectType(name, {
      Component,
      resizable: false,
      aspectLocked: false,
      minSize: 24,
      editableText: false,
      hitTest: () => false,
    });
    expect(registeredObjectTypes()).toContain(name);
    const registered = getObjectType(name);
    expect(registered?.Component).toBe(Component);
    // A type that is not resizable is drawn selected but without handles, and this flag is the
    // only thing the overlay looks at to decide that: it does not know what a sticker is.
    expect(registered?.resizable).toBe(false);
    expect(registered?.minSize).toBe(24);
    expect(registered?.editableText).toBe(false);
    // The spec a later story hands in is held to the same shape as the sticky note's, so the
    // resize maths can be written once for everybody.
    expect(registered).toMatchObject({ aspectLocked: false });
  });

  it('TC-11f registering a type is also what lets this client read objects of that type', () => {
    const name = 'unit-readable-after-registering';
    registerObjectType(name, spec());
    const doc = new Y.Doc();
    initDoc(doc);
    insertRaw(doc, 'shape-1', {
      type: name,
      x: 5,
      y: 6,
      width: 30,
      height: 40,
      z: 2,
    });
    // One call to register a type is enough for it to appear on the board: the model reads the
    // object, and the lookup finds the component to draw it with.
    const read = snapshot(doc).find((object) => object.id === 'shape-1');
    expect(read).toMatchObject({ type: name, x: 5, y: 6, width: 30, height: 40, z: 2 });
    expect(getObjectType(read!.type)?.Component.name).toBe('Widget');
  });
});
