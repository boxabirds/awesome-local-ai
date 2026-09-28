// Story 7, sel.registry — unit tests for the object-type registry
// (TC-11, TC-12, duplicate registration, test-only testbox).
import { describe, it, expect } from 'vitest';
import {
  registerObjectType,
  getObjectType,
} from '../../src/client/objects/registry.tsx';
import { STICKY_MIN_SIZE_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config.ts';
import type { ObjectSnapshot } from '../../src/shared/board-model.ts';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE } from '../fixtures/testbox.tsx';

const sticky: ObjectSnapshot = {
  id: 's1',
  type: 'sticky',
  x: 100,
  y: 200,
  z: 1,
  createdAt: 0,
  width: 200,
  height: 200,
};

describe('object type registry', () => {
  // TC-11: sticky declares resizable + aspect-locked + the sticky minimum,
  // and its hitTest is bounds containment (boundary: inside vs 1 unit out).
  it('TC-11 registers sticky with its resize rules and a bounds hitTest', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');

    // inside the bounds (inclusive edges)
    expect(spec!.hitTest(sticky, { x: 150, y: 250 })).toBe(true);
    expect(spec!.hitTest(sticky, { x: 100, y: 200 })).toBe(true);
    expect(spec!.hitTest(sticky, { x: 300, y: 400 })).toBe(true);
    // 1 unit outside each edge (boundary)
    expect(spec!.hitTest(sticky, { x: 99, y: 300 })).toBe(false);
    expect(spec!.hitTest(sticky, { x: 301, y: 300 })).toBe(false);
    expect(spec!.hitTest(sticky, { x: 200, y: 199 })).toBe(false);
    expect(spec!.hitTest(sticky, { x: 200, y: 401 })).toBe(false);
    // an implicit-size sticky still hit-tests at STICKY_SIZE_WORLD
    const implicit: ObjectSnapshot = { ...sticky, width: undefined, height: undefined };
    expect(spec!.hitTest(implicit, { x: 299, y: 399 })).toBe(true);
    expect(spec!.hitTest(implicit, { x: 301, y: 399 })).toBe(false);
  });

  // TC-12: an unknown type has no spec: not selectable, not resizable.
  it('TC-12 returns undefined for an unknown type', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('registering the same type twice throws (programming error)', () => {
    expect(() => registerObjectType('sticky', getObjectType('sticky')!)).toThrow();
  });

  it('the test-only testbox type is registered and retrievable', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
  });

  // Story 12: an image is an ordinary resizable box object whose proportions are
  // locked (a photo resized smaller stays a photo, never a squashed one) and whose
  // sides never go under IMAGE_MIN_SIZE_WORLD. Its hit area is its box, and it has no
  // text to edit. TC-27 exercises the resize in the browser; this pins the registry
  // declaration those gestures read.
  it('registers image as aspect-locked, resizable, with the image minimum and no text', () => {
    const spec = getObjectType('image');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
    expect(typeof spec!.Component).toBe('function');

    const image: ObjectSnapshot = {
      id: 'i1',
      type: 'image',
      x: 100,
      y: 100,
      z: 1,
      createdAt: 0,
      width: 300,
      height: 150,
    };
    // inside the box, and inclusive on its edges
    expect(spec!.hitTest(image, { x: 250, y: 175 })).toBe(true);
    expect(spec!.hitTest(image, { x: 100, y: 100 })).toBe(true);
    expect(spec!.hitTest(image, { x: 400, y: 250 })).toBe(true);
    // one unit outside each edge is not a hit
    expect(spec!.hitTest(image, { x: 99, y: 175 })).toBe(false);
    expect(spec!.hitTest(image, { x: 401, y: 175 })).toBe(false);
    expect(spec!.hitTest(image, { x: 250, y: 251 })).toBe(false);
  });
});
