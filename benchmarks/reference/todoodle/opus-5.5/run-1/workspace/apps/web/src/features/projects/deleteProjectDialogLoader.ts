import { lazy } from 'react';

let pending: Promise<typeof import('./DeleteProjectDialog.tsx')> | null = null;

/** The delete dialog chunk: preloaded when a project's '…' menu opens (bundle-preload). */
export function preloadDeleteProjectDialog(): Promise<typeof import('./DeleteProjectDialog.tsx')> {
  pending ??= import('./DeleteProjectDialog.tsx').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export const LazyDeleteProjectDialog = lazy(() => preloadDeleteProjectDialog().then((module) => ({ default: module.DeleteProjectDialog })));
