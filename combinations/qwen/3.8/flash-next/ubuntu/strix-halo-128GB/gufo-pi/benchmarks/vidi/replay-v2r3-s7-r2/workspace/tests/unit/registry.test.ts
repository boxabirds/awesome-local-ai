import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { getObjectType, registerObjectType, pointInBounds } from '../../src/client/objects/registry';
import type { ObjectProps, ObjectTypeSpec } from '../../src/client/objects/registry';
import {
  isKnownObjectType,
  objectBounds,
  snapshot,
  createSticky,
  getObjectsMap,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';

/** A second object type, registered exactly the way a story would add one. */
function FakeBox(_props: ObjectProps): null {
  return null;
}

const fakeSpec: ObjectTypeSpec = {
  Component: FakeBox,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: (obj, p) => pointInBounds(obj, p),
};

describe('object type registry — TC-11', () => {
  it('a registered type is usable without any special-casing', () => {
    registerObjectType('faketype', fakeSpec);

    const spec = getObjectType('faketype');
    expect(spec).toBeDefined();
    expect(spec!.Component).toBe(FakeBox);
    expect(spec!.resizable).toBe(false);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.editableText).toBe(false);
    // The model now reads and selects objects of the new type.
    expect(isKnownObjectType('faketype')).toBe(true);
  });

  it('objects of a newly registered type appear in the snapshot', () => {
    registerObjectType('faketype2', { ...fakeSpec });

    const doc = new Y.Doc();
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'faketype2');
      m.set('x', 5);
      m.set('y', 6);
      m.set('width', 40);
      m.set('height', 30);
      m.set('z', 1);
      m.set('createdAt', 0);
      getObjectsMap(doc).set('box-1', m);
    });

    const objects = snapshot(doc);
    expect(objects.map((o) => o.id)).toEqual(['box-1']);
    expect(objectBounds(objects[0])).toEqual({ x: 5, y: 6, width: 40, height: 30 });
  });

  it('sticky notes are registered with their story 2 behaviour', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });
});

describe('object type registry — TC-12', () => {
  it('an unregistered type resolves to undefined and stays off the board', () => {
    expect(getObjectType('mystery')).toBeUndefined();
    expect(isKnownObjectType('mystery')).toBe(false);

    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'mystery');
      m.set('x', 0);
      m.set('y', 0);
      m.set('z', 2);
      m.set('createdAt', 0);
      getObjectsMap(doc).set('future-1', m);
    });
    // Unknown objects are skipped rather than breaking the board.
    expect(snapshot(doc).map((o) => o.id)).not.toContain('future-1');
  });

  it('rejects a duplicate registration instead of silently replacing it', () => {
    registerObjectType('only-once', fakeSpec);
    expect(() => registerObjectType('only-once', fakeSpec)).toThrow(/only-once/);
  });

  it('rejects a useless type key and an incomplete spec', () => {
    expect(() => registerObjectType('', fakeSpec)).toThrow();
    expect(() => registerObjectType('missing-component', { ...fakeSpec, Component: undefined as never })).toThrow();
    expect(() => registerObjectType('missing-hittest', { ...fakeSpec, hitTest: undefined as never })).toThrow();
    expect(getObjectType('missing-component')).toBeUndefined();
  });
});

describe('object type registry — hit testing', () => {
  const obj: ObjectSnapshot = {
    id: 'a',
    type: 'sticky',
    x: 100,
    y: 100,
    z: 1,
    width: 200,
    height: 200,
    createdAt: 0,
  };

  it('hits inside and on the border of the object', () => {
    expect(pointInBounds(obj, { x: 150, y: 150 })).toBe(true);
    expect(pointInBounds(obj, { x: 100, y: 100 })).toBe(true);
    expect(pointInBounds(obj, { x: 300, y: 300 })).toBe(true);
  });

  it('misses outside the object', () => {
    expect(pointInBounds(obj, { x: 99.9, y: 150 })).toBe(false);
    expect(pointInBounds(obj, { x: 300.1, y: 300 })).toBe(false);
  });

  it('uses the default size for an object without a stored size', () => {
    const legacy: ObjectSnapshot = { id: 'b', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 };
    expect(pointInBounds(legacy, { x: STICKY_SIZE_WORLD - 1, y: STICKY_SIZE_WORLD - 1 })).toBe(true);
    expect(pointInBounds(legacy, { x: STICKY_SIZE_WORLD + 1, y: 10 })).toBe(false);
  });

  it('a non-finite point hits nothing', () => {
    expect(pointInBounds(obj, { x: Number.NaN, y: 150 })).toBe(false);
    expect(pointInBounds(obj, { x: 150, y: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('the sticky spec uses the same rule', () => {
    const spec = getObjectType('sticky')!;
    expect(spec.hitTest(obj, { x: 250, y: 250 })).toBe(true);
    expect(spec.hitTest(obj, { x: 400, y: 250 })).toBe(false);
  });
});
