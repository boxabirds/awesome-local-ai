import { lazy } from 'react';

let loading: Promise<typeof import('./ForgetDialog')> | null = null;

/** The ForgetDialog chunk, requested at most once. */
const load = () => (loading ??= import('./ForgetDialog'));

export const LazyForgetDialog = lazy(load);

/** Warms the dialog chunk (row menu open, pointerenter, focus). Same promise every call. */
export function preloadForgetDialog(): Promise<unknown> {
  return load();
}
