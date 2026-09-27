export type VerifyResult = { ok: true } | { ok: false; lastSeenSha: string | null; message: string };

/**
 * Polls <baseUrl>/health until it reports `expectedSha` or `timeoutMs` passes.
 * Network errors, non-2xx and unparsable bodies are treated as transient: keep polling.
 */
export async function verifyHealth(opts: {
  baseUrl: string;
  expectedSha: string;
  env: string;
  timeoutMs: number;
  intervalMs: number;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}): Promise<VerifyResult> {
  const started = opts.now();
  let lastSeenSha: string | null = null;
  for (;;) {
    try {
      const res = await opts.fetch(`${opts.baseUrl}/health`, { headers: { 'Cache-Control': 'no-cache' } });
      if (res.ok) {
        const body = (await res.json()) as { git_sha?: unknown };
        if (typeof body.git_sha === 'string') lastSeenSha = body.git_sha;
        if (lastSeenSha === opts.expectedSha) return { ok: true };
      }
    } catch {
      // transient: keep polling until the timeout
    }
    if (opts.now() - started >= opts.timeoutMs) {
      return {
        ok: false,
        lastSeenSha,
        message: `${opts.env} did not report ${opts.expectedSha} within ${opts.timeoutMs} ms (last seen: ${lastSeenSha ?? 'none'})`,
      };
    }
    await opts.sleep(opts.intervalMs);
  }
}
