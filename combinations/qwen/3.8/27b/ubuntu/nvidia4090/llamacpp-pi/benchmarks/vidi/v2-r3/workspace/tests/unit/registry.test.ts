/**
 * TC-11, TC-12 + duplicate registration: the object type registry
 * (sel.registry).
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { getObjectType, registerObjectType, type ObjectProps, type ObjectTypeSpec } from '../../src/client/objects/registry';

function stubComponent(_props: ObjectProps): ReactElement {
  return null as unknown as ReactElement;
}

const stubSpec = (overrides: Partial<ObjectTypeSpec> = {}): ObjectTypeSpec => ({
  Component: stubComponent,
  resizable: true,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: () => true,
  ...overrides,
});

describe('object type registry (TC-11, TC-12)', () => {
  it('registers a type (testbox) and retrieves its spec', () => {
    registerObjectType('testbox', stubSpec());
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.minSize).toBe(10);
  });

  it('returns undefined for unknown types', () => {
    expect(getObjectType('mystery')).toBeUndefined();
  });

  it('throws on duplicate registration (programming error)', () => {
    registerObjectType('dup', stubSpec());
    expect(() => registerObjectType('dup', stubSpec())).toThrow();
  });

  it('keeps specs independent across types', () => {
    registerObjectType('alpha', stubSpec({ aspectLocked: true }));
    registerObjectType('beta', stubSpec({ resizable: false }));
    expect(getObjectType('alpha')?.aspectLocked).toBe(true);
    expect(getObjectType('beta')?.resizable).toBe(false);
  });
});
