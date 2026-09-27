import { describe, expect, it, vi } from 'vitest';
import { assertLocalServer } from './global-setup';

const healthFetch = (environment: string) =>
  vi.fn(async () =>
    Response.json({ status: 'ok', environment, version: 'dev', git_sha: 'dev', deployed_at: null }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('Playwright globalSetup guard', () => {
  it('TC-I05 throws when the server reports staging, so no specs run', async () => {
    const fetchFn = healthFetch('staging');
    await expect(assertLocalServer('http://127.0.0.1:8787', fetchFn)).rejects.toThrow(
      'Refusing to run tests against staging',
    );
    expect(fetchFn).toHaveBeenCalledWith(new URL('http://127.0.0.1:8787/health'));
  });

  it('passes when the server reports local', async () => {
    await expect(assertLocalServer('http://127.0.0.1:8787', healthFetch('local'))).resolves.toBeUndefined();
  });
});
