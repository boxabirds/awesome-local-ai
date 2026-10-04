import { describe, it, expect } from 'vitest';
import { registerObjectType, getObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';


// ─── TC-11: getObjectType('sticky') ─────────────────────────────────────────
describe('TC-11: sticky type spec', () => {
  it('getObjectType("sticky") returns correct spec', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('hitTest is true inside bounds', () => {
    const spec = getObjectType('sticky')!;
    // A sticky at (0,0) with size 200×200
    const obj = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, color: 'yellow' as const, text: '', createdAt: 0 };
    expect(spec.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(obj, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(obj, { x: 199, y: 199 })).toBe(true);
  });

  it('hitTest is false 1 unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const obj = { id: 'a', type: 'sticky', x: 0, y: 0, z: 1, color: 'yellow' as const, text: '', createdAt: 0 };
    // 1 unit outside the right edge
    expect(spec.hitTest(obj, { x: 200, y: 100 })).toBe(false);
    // 1 unit outside the bottom edge
    expect(spec.hitTest(obj, { x: 100, y: 200 })).toBe(false);
  });
});

// ─── TC-12: getObjectType('unknown') → undefined ───────────────────────────
describe('TC-12: unknown type', () => {
  it('getObjectType("unknown") returns undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });
});

// ─── Duplicate registration throws ──────────────────────────────────────────
describe('Duplicate registration', () => {
  it('registerObjectType("sticky", ...) throws on duplicate', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: true,
        aspectLocked: true,
        minSize: 50,
        editableText: true,
        hitTest: () => false,
      });
    }).toThrow();
  });
});

// ─── Test-only testbox type ─────────────────────────────────────────────────
describe('testbox type (test-only)', () => {
  it('can be registered and retrieved', () => {
    // The testbox fixture registers this; we test it can be looked up
    // (it's registered in the fixture file imported by component tests)
    const spec = getObjectType('testbox');
    // If not yet registered (unit test context), register it here
    if (!spec) {
      registerObjectType('testbox', {
        Component: () => null,
        resizable: true,
        aspectLocked: false,
        minSize: 10,
        editableText: false,
        hitTest: (obj, point) => {
          const w = obj.width ?? 100;
          const h = obj.height ?? 100;
          return point.x >= obj.x && point.x < obj.x + w &&
                 point.y >= obj.y && point.y < obj.y + h;
        },
      });
    }
    const retrieved = getObjectType('testbox');
    expect(retrieved).toBeDefined();
    expect(retrieved!.resizable).toBe(true);
    expect(retrieved!.aspectLocked).toBe(false);
    expect(retrieved!.minSize).toBe(10);
  });
});
