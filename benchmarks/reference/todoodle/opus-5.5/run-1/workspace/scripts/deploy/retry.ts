export type RetryOptions = {
  attempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Called after every attempt: with the error when it failed, without when it succeeded. */
  onAttempt?: (n: number, err?: unknown) => void;
};

/** Runs fn up to `attempts` times. Delay before attempt n+1 is baseDelayMs * 2^(n-1); none after the last. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  if (opts.attempts < 1) throw new Error('withRetry needs at least one attempt');
  for (let n = 1; ; n++) {
    try {
      const value = await fn();
      opts.onAttempt?.(n);
      return value;
    } catch (err) {
      opts.onAttempt?.(n, err);
      if (n >= opts.attempts) throw err;
      await opts.sleep(opts.baseDelayMs * 2 ** (n - 1));
    }
  }
}
