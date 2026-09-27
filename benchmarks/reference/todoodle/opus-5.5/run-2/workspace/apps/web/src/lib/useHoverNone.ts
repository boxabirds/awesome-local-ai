import { useSyncExternalStore } from 'react';

/*
 * True on devices without hover (touch). CSS already reveals hover-only controls there through
 * `[@media(hover:none)]`; this lets components also drop the hide-until-hover classes, so the
 * behaviour doesn't depend on stylesheet support. One shared MediaQueryList for the whole app.
 */
const QUERY = '(hover: none)';
let mql: MediaQueryList | null | undefined;

function mediaQuery(): MediaQueryList | null {
  if (mql === undefined) mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;
  return mql;
}

function subscribe(onChange: () => void): () => void {
  const list = mediaQuery();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

const getSnapshot = () => mediaQuery()?.matches ?? false;

export function useHoverNone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Test hook: re-read matchMedia (tests stub it per case). */
export function resetHoverNoneForTests(): void {
  mql = undefined;
}
