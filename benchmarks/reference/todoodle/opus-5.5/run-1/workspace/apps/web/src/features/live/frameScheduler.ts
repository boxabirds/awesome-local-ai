import { LIVE_FRAME_FALLBACK_MS } from '@todoodle/shared/limits';

/**
 * Runs `cb` once, on the next animation frame. Browsers pause requestAnimationFrame in hidden tabs, so
 * while the document is hidden it uses setTimeout(0) instead, and a visible tab that is hidden before
 * its frame fires is covered by a fallback timer. Live updates never need a focused tab.
 * Used for live frame batches and as TanStack Query's notify scheduler.
 */
export function scheduleFrame(cb: () => void): void {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function') {
    setTimeout(cb, 0);
    return;
  }
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    cb();
  };
  requestAnimationFrame(run);
  setTimeout(run, LIVE_FRAME_FALLBACK_MS);
}
