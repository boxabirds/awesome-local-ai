import { MOBILE_BREAKPOINT_PX } from '@todoodle/shared/limits';
import { useSyncExternalStore } from 'react';

/** Narrow means below MOBILE_BREAKPOINT_PX (767.98px keeps fractional widths on the right side). */
export const NARROW_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 0.02}px)`;

let mql: MediaQueryList | null | undefined;

function mediaQuery(): MediaQueryList | null {
  if (mql === undefined) mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
  return mql;
}

function subscribe(onChange: () => void): () => void {
  const list = mediaQuery();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

const getSnapshot = () => mediaQuery()?.matches ?? false;

/** The phone layout is on. Re-renders only when the mode flips. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Test hook: re-read matchMedia (tests stub it per case). */
export function resetIsNarrowForTests(): void {
  mql = undefined;
}
