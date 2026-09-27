import type { FullConfig } from '@playwright/test';
import { assertLocalTestEnv } from '../apps/api/src/lib/test-guard';

/** Asks the server under test who it is and refuses to continue unless it is local. */
export async function assertLocalServer(baseURL: string, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn(new URL('/health', baseURL));
  const body = (await res.json()) as { environment?: string };
  assertLocalTestEnv({ ENVIRONMENT: body.environment });
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('Playwright baseURL is not configured');
  await assertLocalServer(baseURL);
  // Start from an empty local D1 (the route only exists outside production).
  const reset = await fetch(new URL('/test/reset', baseURL), {
    method: 'POST',
    headers: { 'X-Todoodle-Client': 'web' },
  });
  if (!reset.ok) throw new Error(`POST /test/reset failed: ${reset.status}`);
}
