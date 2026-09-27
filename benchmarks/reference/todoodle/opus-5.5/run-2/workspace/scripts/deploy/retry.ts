/**
 * Calls `fn` up to `attempts` times. The delay before attempt n+1 is baseDelayMs * 2^(n-1);
 * there is no delay after the final attempt. `onAttempt` is told the outcome of every attempt
 * (with the error when it failed). Rethrows the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    baseDelayMs: number;
    sleep: (ms: number) => Promise<void>;
    onAttempt?: (n: number, err?: unknown) => void;
  },
): Promise<T> {
  let lastError: unknown;
  for (let n = 1; n <= opts.attempts; n++) {
    try {
      const result = await fn();
      opts.onAttempt?.(n);
      return result;
    } catch (err) {
      lastError = err;
      opts.onAttempt?.(n, err);
      if (n < opts.attempts) await opts.sleep(opts.baseDelayMs * 2 ** (n - 1));
    }
  }
  throw lastError;
}
