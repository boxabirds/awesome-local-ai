import { useSyncExternalStore } from 'react';

/*
 * Edit gate (architecture section 12). Story 2 ships this stub, which always allows editing;
 * story 4 replaces the implementation (same export) with the real offline-driven store.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;

export function useCanEdit(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
