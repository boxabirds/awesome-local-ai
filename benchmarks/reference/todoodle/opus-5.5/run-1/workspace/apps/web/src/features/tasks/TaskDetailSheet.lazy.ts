import { lazy } from 'react';

// The detail sheet is its own chunk (bundle-dynamic-imports): rows preload it on hover or focus
// (bundle-preload), so it is usually ready by the time a task is opened.

/** Test hook: how many times the chunk was requested (TC-C32). Never read by the app. */
export const taskDetailLoads = { count: 0 };

let loading: Promise<typeof import('./TaskDetailSheet')> | null = null;

export function preloadTaskDetail(): Promise<typeof import('./TaskDetailSheet')> {
  if (!loading) {
    taskDetailLoads.count++;
    loading = import('./TaskDetailSheet');
  }
  return loading;
}

export const LazyTaskDetailSheet = lazy(() => preloadTaskDetail().then((module) => ({ default: module.TaskDetailSheet })));

/** Test helper: forget that the chunk was requested. */
export function resetTaskDetailPreloadForTests(): void {
  loading = null;
  taskDetailLoads.count = 0;
}
