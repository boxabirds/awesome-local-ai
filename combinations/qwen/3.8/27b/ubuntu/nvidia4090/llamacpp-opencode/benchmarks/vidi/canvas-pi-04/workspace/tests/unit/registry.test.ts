// Story 7, task 7: object type registry unit tests (TC-11, TC-12, duplicate).
//
// The registry is the single source of truth for per-type behaviour. Importing
// it registers the built-in `sticky` type at module load; these tests check the
// exposed spec, the unknown-type path and the duplicate-registration guard.

import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import {
  getObjectType,
  registerObjectType,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

function dummySpec(overrides: Partial<ObjectTypeSpec> = {}): ObjectTypeSpec {
  const Component: ComponentType = () => null;
  return {
    Component,
    resizable: false,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: () => false,
    ...overrides,
  };
}

describe('registry: sticky', () => {
  it('TC-11 exposes the sticky spec (resizable, aspect-locked, min size, editable)', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.Component).toBe('function');
  });
});

describe('registry: unknown type', () => {
  it('TC-12 getObjectType returns undefined for an unregistered type', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('shape')).toBeUndefined();
  });
});

describe('registry: duplicate registration', () => {
  it('throws when registering a type that is already registered', () => {
    // 'sticky' is registered at module load.
    expect(() => registerObjectType('sticky', dummySpec())).toThrow();
    // A fresh type registers once, then throws on the second call.
    const spec = dummySpec();
    expect(() => registerObjectType('__dup_test__', spec)).not.toThrow();
    expect(() => registerObjectType('__dup_test__', spec)).toThrow();
  });
});
