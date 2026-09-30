/**
 * The object type registry (`sel.registry`, TC-11, TC-12).
 *
 * Selection, moving, resizing and deleting are written once against this
 * registry: a type only declares whether it can be resized, whether it keeps its
 * proportions, and how small it may go. A type the registry does not know is not
 * selectable, not resizable and not drawn (TC-12).
 */
import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  registeredObjectTypes,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { isKnownObjectType } from '../../src/shared/board-model';
import { MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { BoardObject, ObjectSnapshot } from '../../src/shared/board-model';

const sticky: BoardObject = {
  id: 'a',
  type: 'sticky',
  x: 100,
  y: 200,
  z: 3,
  color: 'yellow',
  text: 'hello',
  width: 200,
  height: 200,
};

describe('object type registry (sel.registry)', () => {
  it('TC-11 declares sticky as resizable, aspect-locked, minimum STICKY_MIN_SIZE_WORLD', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.minSize).toBe(50);
    expect(spec?.editableText).toBe(true);
    expect(typeof spec?.Component).toBe('function');
  });

  // TC-12: the registry is the only place types are known; an unknown one is
  // simply not there, so nothing downstream can select, resize or draw it.
  it('TC-12 has no spec and no model registration for an unknown type', () => {
    expect(getObjectType('shape')).toBeUndefined();
    expect(registeredObjectTypes()).not.toContain('shape');
    expect(isKnownObjectType('shape')).toBe(false);
  });

  it('registers sticky in the shared model too, so the model can read it', () => {
    expect(isKnownObjectType('sticky')).toBe(true);
  });

  it('hit-tests sticky against its own bounds', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.hitTest(sticky, { x: 150, y: 250 })).toBe(true);
    expect(spec?.hitTest(sticky, { x: 100, y: 200 })).toBe(true); // touching the edge is inside
    expect(spec?.hitTest(sticky, { x: 301, y: 250 })).toBe(false);
    expect(spec?.hitTest(sticky, { x: 99, y: 200 })).toBe(false);
  });

  it('throws on a duplicate registration, because that is a programming error', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (object: ObjectSnapshot) => object.id !== '',
    };
    expect(() => registerObjectType('sticky', spec)).toThrow(/sticky/);
    // The original spec survived the rejected registration.
    expect(getObjectType('sticky')?.aspectLocked).toBe(true);
  });

  it('uses one global maximum size for every type (sel.size_limits)', () => {
    expect(MAX_OBJECT_SIZE_WORLD).toBe(20_000);
  });
});
