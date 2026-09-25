import { describe, expect, it, beforeEach } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  __resetRegistry,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

describe('registry', () => {
  beforeEach(() => {
    __resetRegistry();
  });

  // TC-11: getObjectType('sticky') → correct spec
  it('TC-11 registers sticky with correct properties', () => {
    // Manually register to test the contract.
    const stickySpec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: true,
      minSize: STICKY_MIN_SIZE_WORLD,
      editableText: true,
      hitTest(obj, point) {
        const w = obj.width ?? 200;
        const h = obj.height ?? 200;
        return (
          point.x >= obj.x &&
          point.x <= obj.x + w &&
          point.y >= obj.y &&
          point.y <= obj.y + h
        );
      },
    };
    registerObjectType('sticky', stickySpec);

    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);

    // hitTest: inside → true
    const obj = { x: 0, y: 0, width: 200, height: 200 };
    expect(spec!.hitTest(obj, { x: 100, y: 100 })).toBe(true);
    // hitTest: 1 unit outside → false (boundary)
    expect(spec!.hitTest(obj, { x: 201, y: 100 })).toBe(false);
    expect(spec!.hitTest(obj, { x: -1, y: 100 })).toBe(false);
  });

  // TC-12: getObjectType('unknown') → undefined
  it('TC-12 returns undefined for unknown types', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    const spec: ObjectTypeSpec = {
      Component: () => null,
      resizable: false,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    };
    registerObjectType('test', spec);
    expect(() => registerObjectType('test', spec)).toThrow(/already registered/);
  });

  it('testbox type is retrievable (used by component tests)', () => {
    const testboxSpec: ObjectTypeSpec = {
      Component: () => null,
      resizable: true,
      aspectLocked: false,
      minSize: 10,
      editableText: false,
      hitTest: () => true,
    };
    registerObjectType('testbox', testboxSpec);
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(10);
  });
});