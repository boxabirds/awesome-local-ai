/**
 * Unit tests for the object type registry (sel.registry), story 7.
 * TC-11, TC-12, duplicate registration, testbox fixture.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { registerTestBox } from '../fixtures/testbox';
import type { ObjectSnapshot } from '../../src/shared/board-model';

beforeAll(() => {
  registerTestBox();
});

describe('sel.registry', () => {
  // TC-11: sticky spec fields and hitTest boundary.
  it('TC-11: getObjectType("sticky") declares resizable, aspect-locked, minSize 50, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');
  });

  it('TC-11b: sticky hitTest is true inside bounds and false 1 unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const note: ObjectSnapshot = { id: 'n', type: 'sticky', x: 100, y: 100, z: 1, createdAt: 1 };
    // Implicit 200×200 bounds: [100,100]-[300,300]
    expect(spec.hitTest(note, { x: 100, y: 100 })).toBe(true); // corner
    expect(spec.hitTest(note, { x: 300, y: 300 })).toBe(true); // far corner
    expect(spec.hitTest(note, { x: 200, y: 200 })).toBe(true); // centre
    expect(spec.hitTest(note, { x: 99, y: 200 })).toBe(false); // 1 unit outside left
    expect(spec.hitTest(note, { x: 301, y: 200 })).toBe(false); // 1 unit outside right
    expect(spec.hitTest(note, { x: 200, y: 99 })).toBe(false);
    expect(spec.hitTest(note, { x: 200, y: 301 })).toBe(false);
  });

  // TC-12: unknown type → undefined.
  it('TC-12: getObjectType("unknown") is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  // Duplicate registration throws (programming error path).
  it('duplicate registerObjectType("sticky") throws', () => {
    expect(() =>
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 1,
        editableText: false,
        hitTest: () => false,
      }),
    ).toThrow(/duplicate/i);
  });

  // Test-only testbox type is retrievable with the right knobs.
  it('testbox fixture: resizable, NOT aspect-locked, minSize 10', () => {
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
    expect(spec!.editableText).toBe(false);
  });
});
