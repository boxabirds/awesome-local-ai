import { describe, expect, it } from 'vitest';
import {
  registerObjectType,
  getObjectType,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
// Ensure sticky is registered
import '../../src/client/objects/registerTypes';

describe('registry', () => {
  it('TC-11 getObjectType("sticky") returns expected spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('sticky hitTest is true inside bounds and false 1 unit outside', () => {
    const spec = getObjectType('sticky')!;
    const obj = {
      id: 'test',
      type: 'sticky' as const,
      x: 100,
      y: 100,
      color: 'yellow' as const,
      text: '',
      z: 1,
      createdAt: 0,
      width: 200,
      height: 200,
    };
    // Inside
    expect(spec.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    // Edge (boundary)
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // 1 unit outside
    expect(spec.hitTest(obj, { x: 99, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 301, y: 100 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: 99 })).toBe(false);
    expect(spec.hitTest(obj, { x: 100, y: 301 })).toBe(false);
  });

  it('TC-12 getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registerObjectType throws', () => {
    expect(() => registerObjectType('sticky', {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => false,
    })).toThrow();
  });

  it('registers a test-only testbox type (resizable, not aspect-locked, minSize 10)', () => {
    registerObjectType('testbox', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    });
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});
