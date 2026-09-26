import type { FullConfig } from '@playwright/test';
import { assertLocalTestEnv } from '../apps/api/src/lib/test-guard.ts';

/** Asks the server under test which environment it is and refuses anything but local. */
export async function assertLocalServer(baseURL: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(new URL('/health', baseURL));
  const body = (await res.json()) as { environment?: string };
  assertLocalTestEnv({ ENVIRONMENT: body.environment });
}

/** Starts every run from an empty local database (only after the server proved it is local). */
export async function resetLocalData(baseURL: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(new URL('/test/reset', baseURL), { method: 'POST', headers: { 'X-Todoodle-Client': 'web' } });
  if (!res.ok) throw new Error(`POST /test/reset failed with ${res.status}`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('Playwright baseURL is not configured');
  await assertLocalServer(baseURL);
  await resetLocalData(baseURL);
}
