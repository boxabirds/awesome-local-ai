import { MOBILE_BREAKPOINT_PX } from '@todoodle/shared/limits';
import { useSyncExternalStore } from 'react';

/** Narrower than MOBILE_BREAKPOINT_PX (767.98px: fractional widths just under 768 count as narrow). */
export const NARROW_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 0.02}px)`;

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(NARROW_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

/**
 * The phone layout (sidebar in a drawer, floating add button). A boolean store subscription, so
 * components re-render only when the mode flips. Touch capability is CSS-only (`touch:` variant).
 */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
