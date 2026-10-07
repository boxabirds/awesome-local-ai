/**
 * Task 7: Registry unit tests (TC-11, TC-12, duplicate registration).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerObjectType, getObjectType, ObjectTypeSpec, resetRegistry } from '@/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '@/shared/config';
import type { Point } from '@/client/canvas/camera';

describe('object type registry', () => {
  beforeEach(() => {
    // Clean slate for each test
    resetRegistry();
  });

  // ---- TC-11: sticky spec ----
  it('TC-11: getObjectType("sticky") → correct spec with resizable, aspectLocked, minSize, editableText, hitTest', () => {
    const stickyId = registerObjectType('sticky', {
      Component: () => null,
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
      hitTest: (obj: any, worldPoint: Point) => {
        return (
          worldPoint.x >= obj.x &&
          worldPoint.y >= obj.y &&
          worldPoint.x <= obj.x + (obj.width || 200) &&
          worldPoint.y <= obj.y + (obj.height || 200)
        );
      },
    });

    expect(stickyId).toBe('sticky');

    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
    expect(typeof spec?.hitTest).toBe('function');

    // Hit test: inside bounds → true, 1 unit outside → false
    const obj = { id: 'test', type: 'sticky', x: 100, y: 100, width: 200, height: 200, z: 1 };
    expect(spec!.hitTest(obj, { x: 200, y: 200 })).toBe(true);   // inside
    expect(spec!.hitTest(obj, { x: 301, y: 200 })).toBe(false);  // 1 unit outside right edge
  });

  // ---- TC-12: unknown type returns undefined ----
  it('TC-12: getObjectType("unknown") → undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  // ---- Duplicate registration throws ----
  it('Duplicate registerObjectType("sticky",…) throws', () => {
    registerObjectType('mytype', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 50,
      editableText: false,
      hitTest: () => false,
    });

    expect(() => {
      registerObjectType('mytype', {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 50,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow(/already registered/i);
  });

  // ---- Test-only testbox type ----
  it('testbox type is retrievable: resizable, not aspect-locked, minSize 10', () => {
    registerObjectType('testbox', {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: (_obj: any, _wp: Point) => false,
    });

    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(10);
  });
});
