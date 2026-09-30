import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { type ObjectSnapshot, allObjectIds } from '../../src/shared/board-model';
import { TESTBOX_MIN_SIZE } from '../fixtures/testbox';

const sticky: ObjectSnapshot = {
  id: 'n',
  type: 'sticky',
  x: 0,
  y: 0,
  width: STICKY_SIZE_WORLD,
  height: STICKY_SIZE_WORLD,
  z: 1,
  createdAt: 0,
};

describe('sel.registry', () => {
  it('TC-11 sticky spec: resizable, aspect-locked, minimum STICKY_MIN_SIZE_WORLD, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: STICKY_MIN_SIZE_WORLD, editableText: true });
    expect(spec?.hitTest(sticky, { x: 10, y: 10 })).toBe(true);
    expect(spec?.hitTest(sticky, { x: STICKY_SIZE_WORLD, y: STICKY_SIZE_WORLD })).toBe(true);
    expect(spec?.hitTest(sticky, { x: STICKY_SIZE_WORLD + 1, y: 10 })).toBe(false);
    expect(spec?.hitTest(sticky, { x: 10, y: -1 })).toBe(false);
  });

  it('TC-12 unknown types have no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('the test-only testbox type is retrievable and becomes selectable', () => {
    expect(getObjectType('testbox')).toMatchObject({ resizable: true, aspectLocked: false, minSize: TESTBOX_MIN_SIZE });
    expect(allObjectIds([{ ...sticky, id: 'b', type: 'testbox' }])).toEqual(['b']);
  });
});
