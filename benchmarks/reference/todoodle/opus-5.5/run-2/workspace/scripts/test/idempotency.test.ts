import { describe, expect, it } from 'vitest';
import { buildHealth } from '@todoodle/shared/health';
import { fetchDeployedSha, shouldSkipRelease } from '../deploy/idempotency';

const A = 'a3f9c2e1b4d5f60718293a4b5c6d7e8f90a1b2c3';
const B = 'b41e07d9c2a85f3e6d1c0b9a8f7e6d5c4b3a2918';

const healthFor = (sha: string) =>
  (async () =>
    Response.json(
      buildHealth({ ENVIRONMENT: 'staging', APP_VERSION: 'v1.0.0', GIT_SHA: sha, DEPLOYED_AT: '2026-09-27T10:00:00.000Z' }),
    )) as unknown as typeof fetch;

describe('shouldSkipRelease', () => {
  it('TC-D01 same sha, nothing pending -> skip', () => {
    expect(shouldSkipRelease({ deployedSha: A, targetSha: A, pendingMigrations: 0 })).toBe(true);
  });

  it('TC-D02 same sha, 1 pending migration -> release', () => {
    expect(shouldSkipRelease({ deployedSha: A, targetSha: A, pendingMigrations: 1 })).toBe(false);
  });

  it('TC-D03 different sha -> release', () => {
    expect(shouldSkipRelease({ deployedSha: A, targetSha: B, pendingMigrations: 0 })).toBe(false);
  });

  it('TC-D04 unknown deployed sha -> release', () => {
    expect(shouldSkipRelease({ deployedSha: null, targetSha: B, pendingMigrations: 0 })).toBe(false);
  });

  it('TC-D05 local dev build reporting "dev" -> release', () => {
    expect(shouldSkipRelease({ deployedSha: 'dev', targetSha: B, pendingMigrations: 0 })).toBe(false);
  });
});

describe('fetchDeployedSha', () => {
  it('reads git_sha from a real health body', async () => {
    expect(await fetchDeployedSha('https://staging.test', healthFor(A))).toBe(A);
  });

  it('TC-D04 unreachable -> null', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await fetchDeployedSha('https://staging.test', down)).toBeNull();
  });

  it('TC-D04 non-JSON health -> null', async () => {
    const html = (async () => new Response('<html>Bad gateway</html>', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchDeployedSha('https://staging.test', html)).toBeNull();
  });

  it('TC-D04 error status -> null', async () => {
    const err = (async () => new Response('oops', { status: 503 })) as unknown as typeof fetch;
    expect(await fetchDeployedSha('https://staging.test', err)).toBeNull();
  });
});
