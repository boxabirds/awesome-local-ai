import type { FetchLike } from '../deploy/types.ts';
import { describe, expect, it } from 'vitest';
import { buildHealth } from '../../apps/api/src/routes/health.ts';
import { fetchDeployedSha, shouldSkipRelease } from '../deploy/idempotency.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

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

  it('TC-D04 unknown deployed sha (unreachable or non-JSON) -> release', () => {
    expect(shouldSkipRelease({ deployedSha: null, targetSha: B, pendingMigrations: 0 })).toBe(false);
  });

  it('TC-D05 dev build deployed -> release', () => {
    expect(shouldSkipRelease({ deployedSha: 'dev', targetSha: B, pendingMigrations: 0 })).toBe(false);
  });
});

describe('fetchDeployedSha', () => {
  const base = 'https://staging.todoodle.test';

  it('reads git_sha from real health JSON', async () => {
    const fetchImpl = (async () =>
      Response.json(buildHealth({ ENVIRONMENT: 'staging', GIT_SHA: A, APP_VERSION: 'v1.0.0' }))) satisfies FetchLike;
    expect(await fetchDeployedSha(base, fetchImpl)).toBe(A);
  });

  it('TC-D04 is null when unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) satisfies FetchLike;
    expect(await fetchDeployedSha(base, fetchImpl)).toBeNull();
  });

  it('TC-D04 is null for a non-JSON health response', async () => {
    const fetchImpl = (async () => new Response('<html>Bad gateway</html>', { status: 200 })) satisfies FetchLike;
    expect(await fetchDeployedSha(base, fetchImpl)).toBeNull();
  });

  it('is null for an error status', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 503 })) satisfies FetchLike;
    expect(await fetchDeployedSha(base, fetchImpl)).toBeNull();
  });
});
