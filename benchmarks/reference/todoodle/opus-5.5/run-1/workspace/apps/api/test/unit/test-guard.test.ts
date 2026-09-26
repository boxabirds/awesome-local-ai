import { describe, expect, it } from 'vitest';
import { assertLocalTestEnv } from '../../src/lib/test-guard.ts';

describe('assertLocalTestEnv', () => {
  it('TC-I01 passes for local', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'local' })).not.toThrow();
  });

  it('TC-I02 throws naming staging', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'staging' })).toThrow('Refusing to run tests against staging');
  });

  it('TC-I03 throws naming production', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'production' })).toThrow('Refusing to run tests against production');
  });

  it('TC-I04 throws when ENVIRONMENT is missing', () => {
    expect(() => assertLocalTestEnv({})).toThrow(/Refusing to run tests against/);
  });
});
