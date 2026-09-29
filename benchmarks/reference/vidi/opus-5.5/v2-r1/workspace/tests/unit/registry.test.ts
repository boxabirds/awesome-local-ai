// sel.registry: object type registry (TC-11, TC-12, duplicate registration).
import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { StickyNote } from '../../src/client/objects/StickyNote';
import type { StickySnapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_MIN_SIZE } from '../component/testbox';

const note: StickySnapshot = {
  id: 'n',
  type: 'sticky',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  z: 1,
  createdAt: 0,
  color: 'yellow',
  text: '',
};

describe('object type registry', () => {
  it('TC-11 sticky is resizable, aspect-locked, min STICKY_MIN_SIZE_WORLD, with editable text', () => {
    const spec = getObjectType('sticky')!;
    expect(spec).toMatchObject({
      Component: StickyNote,
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(spec.hitTest(note, { x: 0, y: 0 })).toBe(true);
    expect(spec.hitTest(note, { x: 200, y: 100 })).toBe(true);
    expect(spec.hitTest(note, { x: 201, y: 100 })).toBe(false);
    expect(spec.hitTest(note, { x: 100, y: -1 })).toBe(false);
  });

  it('TC-12 an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
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
    });
  });
});
