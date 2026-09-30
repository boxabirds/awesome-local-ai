import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  registerStickyType,
  _resetRegistryForTesting,
  type ObjectTypeSpec,
} from '@client/objects/registry';
import { objectBounds } from '@shared/board-model';
import type { ObjectSnapshot } from '@shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';

describe('registry', () => {
  beforeEach(() => {
    _resetRegistryForTesting();
  });

  // TC-11: getObjectType('sticky') → spec with correct fields
  it('TC-11: sticky spec has resizable=true, aspectLocked=true, minSize=STICKY_MIN_SIZE_WORLD, editableText=true', () => {
    // Use a dummy component for testing
    const DummyComponent = (() => null) as unknown as ObjectTypeSpec['Component'];
    registerStickyType(DummyComponent);

    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest true inside bounds, false 1 unit outside', () => {
    const DummyComponent = (() => null) as unknown as ObjectTypeSpec['Component'];
    registerStickyType(DummyComponent);

    const obj: ObjectSnapshot = {
      id: 'test-1',
      type: 'sticky',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      color: 'yellow',
      text: '',
      z: 1,
      createdAt: 1,
    };
    const spec = getObjectType('sticky')!;
    // Inside bounds
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // On boundary
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 300, y: 300 })).toBe(true);
    // Outside by 1 unit
    expect(spec.hitTest(obj, { x: 99, y: 150 })).toBe(false);
    expect(spec.hitTest(obj, { x: 150, y: 301 })).toBe(false);
  });

  // TC-12: getObjectType('unknown') → undefined
  it('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  // Duplicate registration throws
  it('duplicate registration throws', () => {
    const DummyComponent = (() => null) as unknown as ObjectTypeSpec['Component'];
    registerObjectType('testtype', {
      Component: DummyComponent,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    });
    expect(() =>
      registerObjectType('testtype', {
        Component: DummyComponent,
        resizable: true,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: () => true,
      }),
    ).toThrow();
  });

  // Testbox type (used by component tests)
  it('testbox type is retrievable with correct fields', () => {
    const DummyComponent = (() => null) as unknown as ObjectTypeSpec['Component'];
    registerObjectType('testbox', {
      Component: DummyComponent,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (obj, pt) => {
        const b = objectBounds(obj);
        return pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
      },
    });
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
