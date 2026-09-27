/** True only when the target revision is already live and there is nothing to migrate. */
export function shouldSkipRelease(input: {
  deployedSha: string | null;
  targetSha: string;
  pendingMigrations: number;
}): boolean {
  return input.deployedSha === input.targetSha && input.pendingMigrations === 0;
}

/** The git_sha an environment reports on /health, or null if unreachable or unparsable. */
export async function fetchDeployedSha(baseUrl: string, fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${baseUrl}/health`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { git_sha?: unknown };
    return typeof body.git_sha === 'string' ? body.git_sha : null;
  } catch {
    return null;
  }
}
