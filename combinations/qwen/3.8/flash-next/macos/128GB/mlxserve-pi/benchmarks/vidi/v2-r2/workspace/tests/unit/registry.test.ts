// The object registry: the one table that decides how every object type
// behaves (TC-11, TC-12).

import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import {
  getObjectType,
  hitTestObject,
  registerObjectType,
  registeredTypes,
  type ObjectProps,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { objectBounds, type Rect } from '../../src/shared/geometry';
import {
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TYPE_STICKY,
} from '../../src/shared/config';

describe('object registry', () => {
  // TC-11
  it('knows the sticky note with its real settings', () => {
    const spec = getObjectType(TYPE_STICKY);

    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(typeof spec?.Component).toBeDefined();
    expect(registeredTypes()).toContain(TYPE_STICKY);
  });

  // TC-11
  it('an unknown type stays null, which is how the renderer skips it', () => {
    expect(getObjectType('shape-1')).toBeUndefined();
    expect(hitTestObject({ id: 's', type: 'shape-1', x: 0, y: 0, z: 1 }, { x: 0, y: 0 })).toBe(false);
  });

  it('a second registration of a type is a bug, not an overwrite', () => {
    const probe: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    };
    registerObjectType('probe-type', probe);
    expect(() => registerObjectType('probe-type', probe)).toThrow();
  });

  // TC-12
  it('hit-tests a sticky across its bounds, defaulting the size like objectBounds', () => {
    const sticky = { id: 'n', type: TYPE_STICKY, x: 100, y: 100, z: 1 } as const;

    expect(hitTestObject(sticky, { x: 200, y: 200 })).toBe(true); // centre
    expect(hitTestObject(sticky, { x: 100, y: 100 })).toBe(true); // inside corner
    expect(hitTestObject(sticky, { x: 100 + STICKY_SIZE_WORLD + 1, y: 200 })).toBe(false); // 1 outside
    expect(hitTestObject(sticky, { x: 100 - 1, y: 200 })).toBe(false);
  });

  it('hit-tests a resized sticky by its stored size', () => {
    const resized = {
      id: 'n',
      type: TYPE_STICKY,
      x: 0,
      y: 0,
      z: 1,
      width: 300,
      height: 300,
    };

    expect(hitTestObject(resized, { x: 299, y: 299 })).toBe(true);
    expect(hitTestObject(resized, { x: 300, y: 299 })).toBe(false);
  });

  it('the registry is the only source of the size settings', () => {
    expect(MAX_OBJECT_SIZE_WORLD).toBeGreaterThan(STICKY_MIN_SIZE_WORLD);
    const box: Rect = { x: 0, y: 0, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };
    expect(objectBounds({ id: 'n', type: TYPE_STICKY, x: 0, y: 0, z: 1 })).toEqual(box);
  });

  it('a test-registered type is answerable like any other', () => {
    const seen: string[] = [];
    registerObjectType('unit-thing', {
      Component: ((props: ObjectProps) => {
        void props;
        return null;
      }) as ComponentType<ObjectProps>,
      resizable: false,
      aspectLocked: false,
      minSize: 0,
      editableText: false,
      hitTest: (obj) => {
        seen.push(obj.id);
        return true;
      },
    });

    const spec = getObjectType('unit-thing');
    expect(spec?.resizable).toBe(false);
    expect(hitTestObject({ id: 'u', type: 'unit-thing', x: 0, y: 0, z: 1 }, { x: -5, y: -5 })).toBe(true);
    expect(seen).toEqual(['u']);
  });

  it('hitTestObject falls through the registry, unknown types answering false', () => {
    expect(hitTestObject({ id: 'n', type: TYPE_STICKY, x: 0, y: 0, z: 1 }, { x: 10, y: 10 })).toBe(true);
    expect(hitTestObject({ id: 's', type: 'shape-1', x: 0, y: 0, z: 1 }, { x: 0, y: 0 })).toBe(false);
  });
});
