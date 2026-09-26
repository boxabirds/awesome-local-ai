import type { FetchLike } from './types.ts';

/** Skip only when the environment already serves the target revision and there is nothing to migrate. */
export function shouldSkipRelease(input: { deployedSha: string | null; targetSha: string; pendingMigrations: number }): boolean {
  return input.deployedSha === input.targetSha && input.pendingMigrations === 0;
}

/** The git_sha an environment reports on /health, or null when unreachable or unparsable (treated as not live). */
export async function fetchDeployedSha(baseUrl: string, fetchImpl: FetchLike): Promise<string | null> {
  try {
    const res = await fetchImpl(new URL('/health', baseUrl), { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { git_sha?: unknown };
    return typeof body.git_sha === 'string' ? body.git_sha : null;
  } catch {
    return null;
  }
}
