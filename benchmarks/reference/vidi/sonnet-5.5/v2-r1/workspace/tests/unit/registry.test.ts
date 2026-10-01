import { describe, expect, it } from 'vitest';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { StickyNote } from '../../src/client/objects/StickyNote';

const at = (x: number, y: number) => ({ x, y });

describe('object type registry', () => {
  it('TC-11 sticky declares resizable, aspect locked, minimum size and editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(spec?.Component).toBe(StickyNote);
    const obj = { id: 'a', type: 'sticky', x: 100, y: 100, width: 200, height: 200, z: 1, createdAt: 0 };
    expect(spec?.hitTest(obj, at(100, 100))).toBe(true);
    expect(spec?.hitTest(obj, at(300, 300))).toBe(true);
    expect(spec?.hitTest(obj, at(301, 200))).toBe(false);
    expect(spec?.hitTest(obj, at(99, 200))).toBe(false);
  });

  it('TC-12 an unknown type is undefined', () => {
    expect(getObjectType('unknown')).toBeUndefined();
  });

  it('registering a type twice throws', () => {
    const spec = getObjectType('sticky')!;
    expect(() => registerObjectType('sticky', spec)).toThrow(/already registered/);
  });

  it('a newly registered type is retrievable', () => {
    const spec = { ...getObjectType('sticky')!, aspectLocked: false, minSize: 10 };
    registerObjectType('registry-test-type', spec);
    expect(getObjectType('registry-test-type')).toBe(spec);
  });
});
