import { describe, it, expect } from 'vitest';
import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
// Importing the registry registers 'sticky' as a side effect.
import '../../src/client/objects/registry';

const fake: ObjectSnapshot = {
  id: 'fake',
  type: 'sticky',
  x: 0,
  y: 0,
  z: 1,
  width: 200,
  height: 200,
};

/**
 * Story 7 (sel.registry): one declaration per type — component, resizable,
 * aspectLocked, minSize, editableText, hitTest. Selection, moving, resizing,
 * nudging and deletion stay generic (sel.all_types).
 */
describe('object type registry', () => {
  // TC-11
  it('TC-11: the sticky spec declares {resizable, aspectLocked, minSize, editableText}; hitTest inside/outside', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');

    const obj = fake;
    expect(spec!.hitTest(obj, { x: 100, y: 100 })).toBe(true); // centre
    expect(spec!.hitTest(obj, { x: 0.5, y: 0.5 })).toBe(true); // near top-left corner
    expect(spec!.hitTest(obj, { x: 199.9, y: 199.9 })).toBe(true); // near bottom-right corner
    expect(spec!.hitTest(obj, { x: 200, y: 100 })).toBe(true); // on the boundary counts as inside
    expect(spec!.hitTest(obj, { x: 200.1, y: 100 })).toBe(false); // just past the right edge
    expect(spec!.hitTest(obj, { x: 100, y: 200.1 })).toBe(false); // just past the bottom edge
    expect(spec!.hitTest(obj, { x: -0.1, y: 100 })).toBe(false); // just past the left edge
    expect(spec!.hitTest(obj, { x: 100, y: -0.1 })).toBe(false); // just past the top edge
  });

  it('hitTest uses STICKY_SIZE_WORLD when width/height are absent (legacy objects)', () => {
    const spec = getObjectType('sticky')!;
    const legacy: ObjectSnapshot = { id: 'l', type: 'sticky', x: 10, y: 20, z: 1 };
    expect(spec.hitTest(legacy, { x: 100, y: 120 })).toBe(true);
    expect(spec.hitTest(legacy, { x: 220, y: 120 })).toBe(false);
  });

  // TC-12
  it('TC-12: unknown type → undefined; duplicate registration → throws', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();

    const dup: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 0,
      editableText: false,
      hitTest: () => false,
    };
    expect(() => registerObjectType('sticky', dup)).toThrow();
    // The original registration survives the failed duplicate.
    expect(getObjectType('sticky')).toBeDefined();
  });

  it('a newly registered type is retrievable', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 1,
      editableText: false,
      hitTest: () => false,
    };
    registerObjectType('custom-test-1', spec);
    expect(getObjectType('custom-test-1')).toBe(spec);
  });

  it('the test-only testbox type registers with {resizable, !aspectLocked, minSize 10}', async () => {
    const fixture = await import('../fixtures/testbox');
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(fixture.TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
  });
});
