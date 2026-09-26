import { LIVE_RECONNECT_BASE_MS, LIVE_RECONNECT_JITTER, LIVE_RECONNECT_MAX_MS } from '@todoodle/shared/limits';

/**
 * Wait before reconnect attempt n (from 0): min(BASE * 2^n, MAX), scaled by a random factor in
 * [1 - JITTER, 1 + JITTER]. `random` returns [0, 1] (injectable for tests).
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(LIVE_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt), LIVE_RECONNECT_MAX_MS);
  return base * (1 + LIVE_RECONNECT_JITTER * (2 * random() - 1));
}
