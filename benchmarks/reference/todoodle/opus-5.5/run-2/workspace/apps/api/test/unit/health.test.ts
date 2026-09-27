import { describe, expect, it } from 'vitest';
import { buildHealth } from '../../src/routes/health';

describe('buildHealth', () => {
  it('TC-H01 reports injected release metadata', () => {
    const sha = 'a3f9c2e1b4d5f60718293a4b5c6d7e8f90a1b2c3';
    expect(
      buildHealth({
        ENVIRONMENT: 'staging',
        APP_VERSION: 'v1.2.0',
        GIT_SHA: sha,
        DEPLOYED_AT: '2026-09-27T10:15:00.000Z',
      }),
    ).toEqual({
      status: 'ok',
      environment: 'staging',
      version: 'v1.2.0',
      git_sha: sha,
      deployed_at: '2026-09-27T10:15:00.000Z',
    });
  });

  it('TC-H02 falls back to local defaults when nothing is injected', () => {
    expect(buildHealth({})).toEqual({
      status: 'ok',
      environment: 'local',
      version: 'dev',
      git_sha: 'dev',
      deployed_at: null,
    });
  });
});
