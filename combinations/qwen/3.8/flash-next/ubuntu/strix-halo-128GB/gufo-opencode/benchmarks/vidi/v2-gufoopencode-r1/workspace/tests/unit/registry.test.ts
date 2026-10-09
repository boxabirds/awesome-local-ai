import { describe, expect, it } from 'vitest';
import { getObjectType } from '../../src/client/objects/registry';
import { registerObjectType } from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { ObjectSnapshot, StickySnapshot } from '../../src/shared/board-model';
import { ensureTestboxRegistered, TESTBOX_TYPE } from '../fixtures/testbox';

const stickyAt = (x: number, y: number, width: number, height: number): StickySnapshot => ({
  id: 'obj-1',
  type: 'sticky',
  x,
  y,
  z: 1,
  createdAt: 0,
  width,
  height,
  color: 'yellow',
  text: ''
});

describe('object type registry (sel.registry)', () => {
  it('TC-11: sticky is registered as a resizable, aspect-locked, text-editable type', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('TC-11 boundary: sticky hitTest is true inside bounds, false 1 unit outside', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    const obj = stickyAt(100, 100, 200, 200);
    expect(spec?.hitTest(obj, { x: 150, y: 150 })).toBe(true);
    expect(spec?.hitTest(obj, { x: 299, y: 299 })).toBe(true);
    expect(spec?.hitTest(obj, { x: 301, y: 150 })).toBe(false);
    expect(spec?.hitTest(obj, { x: 150, y: 99 })).toBe(false);
  });

  it('TC-12: unknown types have no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('duplicate registration throws (programming error)', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 0,
        editableText: false,
        hitTest: () => false
      });
    }).toThrow(/already registered/);
  });

  it('a test-only type registers and is retrievable', () => {
    ensureTestboxRegistered();
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(10);
    expect(spec?.editableText).toBe(false);
    const box: ObjectSnapshot = { id: 'b1', type: TESTBOX_TYPE, x: 0, y: 0, z: 1, createdAt: 0, width: 120, height: 60 };
    expect(spec?.hitTest(box, { x: 10, y: 10 })).toBe(true);
    expect(spec?.hitTest(box, { x: 121, y: 10 })).toBe(false);
  });
});
