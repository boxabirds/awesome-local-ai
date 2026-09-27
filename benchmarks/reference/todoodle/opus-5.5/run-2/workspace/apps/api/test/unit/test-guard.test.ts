import { describe, expect, it } from 'vitest';
import { assertLocalTestEnv } from '../../src/lib/test-guard';

describe('assertLocalTestEnv', () => {
  it('TC-I01 passes for local', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'local' })).not.toThrow();
  });

  it('TC-I02 refuses staging, naming it', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'staging' })).toThrow(
      'Refusing to run tests against staging',
    );
  });

  it('TC-I03 refuses production, naming it', () => {
    expect(() => assertLocalTestEnv({ ENVIRONMENT: 'production' })).toThrow(
      'Refusing to run tests against production',
    );
  });

  it('TC-I04 refuses when ENVIRONMENT is missing', () => {
    expect(() => assertLocalTestEnv({})).toThrow(/Refusing to run tests/);
  });
});
