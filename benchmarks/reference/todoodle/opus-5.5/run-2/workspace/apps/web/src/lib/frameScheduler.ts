/**
 * Runs `callback` on the next animation frame, or on a zero timeout while the tab is hidden
 * (browsers pause requestAnimationFrame there, and live updates must not need a visible tab).
 */
export function scheduleFrame(callback: () => void): void {
  const hidden = typeof document === 'undefined' || document.visibilityState === 'hidden';
  if (hidden || typeof requestAnimationFrame !== 'function') setTimeout(callback, 0);
  else requestAnimationFrame(() => callback());
}
