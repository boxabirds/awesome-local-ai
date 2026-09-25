import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { TESTBOX_MIN_SIZE } from '../fixtures/testbox';
import { isKnownObjectType, type ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

const note: ObjectSnapshot = { id: 'n', type: 'sticky', x: 0, y: 0, width: 200, height: 200, z: 1 };

describe('object type registry (sel.registry)', () => {
  it('TC-11 sticky notes are resizable, keep their proportions, have a minimum size and editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(spec!.Component).toBeDefined();
    // Hit test: inside and on the edge hits; 1 unit outside does not.
    expect(spec!.hitTest(note, { x: 100, y: 100 })).toBe(true);
    expect(spec!.hitTest(note, { x: 200, y: 200 })).toBe(true);
    expect(spec!.hitTest(note, { x: 201, y: 100 })).toBe(false);
    expect(spec!.hitTest(note, { x: 100, y: -1 })).toBe(false);
  });

  it('TC-12 an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(isKnownObjectType('unknown')).toBe(false);
  });

  it('registering a type twice throws', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    expect(getObjectType('testbox')).toMatchObject({
      resizable: true,
      aspectLocked: false,
      minSize: TESTBOX_MIN_SIZE,
      editableText: false,
    });
    expect(TESTBOX_MIN_SIZE).toBe(10);
    expect(isKnownObjectType('testbox')).toBe(true);
  });
});
