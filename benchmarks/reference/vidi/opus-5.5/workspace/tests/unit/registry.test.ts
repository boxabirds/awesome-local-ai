import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { StickyNote } from '../../src/client/objects/StickyNote';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';

const NOTE: ObjectSnapshot = { id: 'n', type: 'sticky', x: 100, y: 50, z: 1, createdAt: 0 };

describe('sel.registry', () => {
  it('TC-11 sticky: resizable, aspect-locked, STICKY_MIN_SIZE_WORLD, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({
      Component: StickyNote,
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
  });

  it('TC-11 sticky hitTest: inside and on the edge true, 1 unit outside false (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const right = NOTE.x + STICKY_SIZE_WORLD;
    expect(spec.hitTest(NOTE, { x: NOTE.x + 1, y: NOTE.y + 1 })).toBe(true);
    expect(spec.hitTest(NOTE, { x: right, y: NOTE.y })).toBe(true);
    expect(spec.hitTest(NOTE, { x: right + 1, y: NOTE.y })).toBe(false);
    expect(spec.hitTest(NOTE, { x: NOTE.x, y: NOTE.y - 1 })).toBe(false);
  });

  it('TC-12 an unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws (programming error)', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('the test-only testbox type is registered: resizable, not aspect-locked, minSize 10', () => {
    expect(getObjectType(TESTBOX_TYPE)).toMatchObject({
      resizable: true,
      aspectLocked: false,
      minSize: TESTBOX_MIN_SIZE,
      editableText: false,
    });
  });
});
