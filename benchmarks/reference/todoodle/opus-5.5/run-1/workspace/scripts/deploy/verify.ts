import type { FetchLike } from './types.ts';

export type VerifyOptions = {
  baseUrl: string;
  expectedSha: string;
  env: string;
  timeoutMs: number;
  intervalMs: number;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type VerifyResult = { ok: true } | { ok: false; lastSeenSha: string | null; message: string };

/**
 * Polls <baseUrl>/health until it reports expectedSha or the timeout passes.
 * Network errors, non-2xx and unparsable responses are transient: polling continues.
 */
export async function verifyHealth(opts: VerifyOptions): Promise<VerifyResult> {
  const started = opts.now();
  let lastSeenSha: string | null = null;
  for (;;) {
    try {
      const res = await opts.fetch(new URL('/health', opts.baseUrl), { headers: { 'Cache-Control': 'no-cache' } });
      if (res.ok) {
        const body = (await res.json()) as { git_sha?: unknown };
        if (typeof body.git_sha === 'string') lastSeenSha = body.git_sha;
        if (lastSeenSha === opts.expectedSha) return { ok: true };
      }
    } catch {
      // transient: keep polling
    }
    if (opts.now() - started + opts.intervalMs > opts.timeoutMs) {
      return {
        ok: false,
        lastSeenSha,
        message: `${opts.env} did not report revision ${opts.expectedSha} within ${opts.timeoutMs} ms (last seen: ${lastSeenSha ?? 'none'})`,
      };
    }
    await opts.sleep(opts.intervalMs);
  }
}
