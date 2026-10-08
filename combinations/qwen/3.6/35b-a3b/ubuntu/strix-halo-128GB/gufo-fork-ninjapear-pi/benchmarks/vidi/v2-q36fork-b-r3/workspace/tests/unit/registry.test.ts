import { describe, it, expect } from 'vitest';
import {
  registerObjectType,
  getObjectType,
  ObjectTypeSpec,
} from '@client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';
import type { StickySnapshot } from '@shared/board-model';
import type { Point } from '@client/canvas/camera';

// ─── TC-11: object type spec shape (manual registration) ───────────────

describe('TC-11: object type spec shape', () => {
  const testSpec: ObjectTypeSpec = {
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    hitTest: (_obj: StickySnapshot, _pt: Point) => false,
    Component: {} as any,
  };

  it('spec exposes all required fields correctly', () => {
    expect(testSpec.resizable).toBe(true);
    expect(testSpec.aspectLocked).toBe(true);
    expect(testSpec.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(testSpec.editableText).toBe(true);
    expect(typeof testSpec.hitTest).toBe('function');
  });

  it('STICKY_MIN_SIZE_WORLD is 50', () => {
    expect(STICKY_MIN_SIZE_WORLD).toBe(50);
  });
});

// ─── TC-12: unknown type returns undefined ─────────────────────────────

describe('TC-12: getObjectType for unknown → undefined', () => {
  it('unknown type returns undefined', () => {
    expect(getObjectType('shape')).toBeUndefined();
    expect(getObjectType('image')).toBeUndefined();
    expect(getObjectType('text')).toBeUndefined();
  });
});

// ─── Duplicate registration throws ─────────────────────────────────────

describe('Duplicate registration throws', () => {
  const fakeHitTest = () => true;
  const stub = {
    Component: {} as any,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: fakeHitTest,
  };

  it('registering same type twice throws Error', () => {
    registerObjectType('regtest-type', stub);
    expect(() => {
      registerObjectType('regtest-type', stub);
    }).toThrow(/duplicate|already registered/i);
  });

  it('first registration succeeds and lookup works', () => {
    expect(getObjectType('regtest-type2')).toBeUndefined();
    registerObjectType('regtest-type2', stub);
    const got = getObjectType('regtest-type2');
    expect(got).toBeDefined();
    expect(got?.resizable).toBe(true);
    expect(got?.minSize).toBe(10);
  });
});
