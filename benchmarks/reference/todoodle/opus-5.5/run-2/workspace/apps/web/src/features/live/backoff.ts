import { LIVE_RECONNECT_BASE_MS, LIVE_RECONNECT_JITTER, LIVE_RECONNECT_MAX_MS } from '@todoodle/shared/limits';

/**
 * Delay before retry number `attempt` (from 0): min(BASE * 2^attempt, MAX), then +/- JITTER.
 * `random` returns [0, 1]: 0 gives the lower jitter bound, 1 the upper, 0.5 none.
 */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(LIVE_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt), LIVE_RECONNECT_MAX_MS);
  return Math.round(capped * (1 + LIVE_RECONNECT_JITTER * (2 * random() - 1)));
}
