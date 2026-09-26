import { describe, expect, it } from 'vitest';
import { buildHealth } from '../../src/routes/health.ts';

describe('buildHealth', () => {
  it('TC-H01 reports injected release metadata', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(
      buildHealth({
        ENVIRONMENT: 'staging',
        APP_VERSION: 'v1.2.0',
        GIT_SHA: sha,
        DEPLOYED_AT: '2026-09-25T12:34:56.000Z',
      }),
    ).toEqual({
      status: 'ok',
      environment: 'staging',
      version: 'v1.2.0',
      git_sha: sha,
      deployed_at: '2026-09-25T12:34:56.000Z',
    });
  });

  it('TC-H02 falls back to local dev values when nothing is injected', () => {
    expect(buildHealth({})).toEqual({
      status: 'ok',
      environment: 'local',
      version: 'dev',
      git_sha: 'dev',
      deployed_at: null,
    });
  });
});
