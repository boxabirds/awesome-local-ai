import { useSyncExternalStore } from 'react';

/** Devices without a hover-capable pointer (touch screens): the CSS `touch:` variant's query. */
export const HOVER_NONE_QUERY = '(hover: none)';

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(HOVER_NONE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(HOVER_NONE_QUERY).matches;
}

/**
 * True on touch screens. CSS (`touch:`) already reveals hover-only controls there; this lets a component also
 * drop its hover-only classes, so the control is visible even where the media query is not evaluated.
 */
export function useHoverNone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
