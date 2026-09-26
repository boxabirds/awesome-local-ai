import { lazy } from 'react';

/** Test hook: how many times the picker chunk was requested. Never read by the app. */
export const moveToPickerLoads = { count: 0 };

let pending: Promise<typeof import('./MoveToPicker.tsx')> | null = null;

/** The Move to… chunk: preloaded when a task menu opens and on the first M press (bundle-preload). */
export function preloadMoveToPicker(): Promise<typeof import('./MoveToPicker.tsx')> {
  if (!pending) {
    moveToPickerLoads.count++;
    pending = import('./MoveToPicker.tsx').catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export const LazyMoveToPicker = lazy(() => preloadMoveToPicker().then((module) => ({ default: module.MoveToPicker })));
