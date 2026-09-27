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
}
