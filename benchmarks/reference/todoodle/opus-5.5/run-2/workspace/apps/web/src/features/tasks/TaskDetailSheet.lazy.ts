import { lazy } from 'react';

/** The detail sheet's chunk. Called on row hover or focus, so it is usually loaded before a click. */
const load = () => import('./TaskDetailSheet');

export const LazyTaskDetailSheet = lazy(load);

/** Starts loading the sheet's chunk (idempotent: the module loader caches it). */
export function preloadTaskDetail(): void {
  void load();
}
