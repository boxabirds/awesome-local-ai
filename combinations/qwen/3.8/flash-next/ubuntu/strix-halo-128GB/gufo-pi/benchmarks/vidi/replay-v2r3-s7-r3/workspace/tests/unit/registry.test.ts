import { describe, it, expect } from 'vitest';
import React from 'react';
import {
  registerObjectType,
  getObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import '../../tests/fixtures/testbox';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('registry — getObjectType (TC-11)', () => {
  it('TC-11: sticky spec has correct properties', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest returns true for point inside bounds', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 0, y: 0, color: 'yellow' as const, text: '', z: 1, createdAt: 0 };
    expect(spec.hitTest(obj, { x: 50, y: 50 })).toBe(true);
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(obj, { x: 199, y: 199 })).toBe(true);
  });

  it('TC-11: sticky hitTest returns false for point outside bounds (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 0, y: 0, color: 'yellow' as const, text: '', z: 1, createdAt: 0 };
    expect(spec.hitTest(obj, { x: -1, y: 50 })).toBe(false);
    expect(spec.hitTest(obj, { x: 200, y: 50 })).toBe(false);
    expect(spec.hitTest(obj, { x: 50, y: -1 })).toBe(false);
    expect(spec.hitTest(obj, { x: 50, y: 200 })).toBe(false);
  });

  it('TC-11: hitTest respects explicit width/height', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'x', type: 'sticky' as const, x: 0, y: 0, color: 'yellow' as const, text: '', z: 1, createdAt: 0, width: 400, height: 400 };
    expect(spec.hitTest(obj, { x: 350, y: 350 })).toBe(true);
    expect(spec.hitTest(obj, { x: 401, y: 200 })).toBe(false);
  });
});

describe('registry — unknown types (TC-12)', () => {
  it('TC-12: getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('getObjectType("") returns undefined', () => {
    expect(getObjectType('')).toBeUndefined();
  });
});

describe('registry — duplicate registration throws', () => {
  it('registering "sticky" again throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow();
  });
});

describe('registry — testbox type', () => {
  it('testbox is registered and retrievable with correct properties', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
