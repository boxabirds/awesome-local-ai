import { describe, expect, it, vi } from 'vitest';
import { buildHealth } from '../../apps/api/src/routes/health.ts';
import { assertLocalServer } from '../../e2e/global-setup.ts';

function healthFetch(environment: string) {
  return vi.fn(async () => Response.json(buildHealth({ ENVIRONMENT: environment }))) as unknown as typeof fetch;
}

describe('Playwright global setup', () => {
  it('TC-I05 refuses to run specs when the server reports staging', async () => {
    const fetchImpl = healthFetch('staging');
    await expect(assertLocalServer('http://127.0.0.1:8787', fetchImpl)).rejects.toThrow(
      'Refusing to run tests against staging',
    );
    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:8787/health'));
  });

  it('allows a local server', async () => {
    await expect(assertLocalServer('http://127.0.0.1:8787', healthFetch('local'))).resolves.toBeUndefined();
  });
});
