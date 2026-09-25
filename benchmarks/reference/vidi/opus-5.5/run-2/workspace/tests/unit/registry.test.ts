import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { TESTBOX_MIN_SIZE, TESTBOX_TYPE } from '../fixtures/testbox';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';

const note: ObjectSnapshot = {
  id: 'n',
  type: 'sticky',
  x: 100,
  y: 100,
  width: STICKY_SIZE_WORLD,
  height: STICKY_SIZE_WORLD,
  z: 1,
  createdAt: 0,
};

describe('sel.registry', () => {
  it('TC-11 sticky: resizable, aspect-locked, STICKY_MIN_SIZE_WORLD, editable text; hitTest on bounds', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(spec?.hitTest(note, { x: 150, y: 150 })).toBe(true);
    expect(spec?.hitTest(note, { x: 100 + STICKY_SIZE_WORLD, y: 150 })).toBe(true); // edge
    expect(spec?.hitTest(note, { x: 100 + STICKY_SIZE_WORLD + 1, y: 150 })).toBe(false);
    expect(spec?.hitTest(note, { x: 150, y: 99 })).toBe(false);
  });

  it('TC-12 an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('the test-only testbox type is retrievable: resizable, not locked, minSize 10', () => {
    expect(getObjectType(TESTBOX_TYPE)).toMatchObject({
      resizable: true,
      aspectLocked: false,
      minSize: TESTBOX_MIN_SIZE,
      editableText: false,
    });
  });
});
