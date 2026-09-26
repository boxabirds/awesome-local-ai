import { lazy } from 'react';

let pending: Promise<typeof import('./CreateProjectDialog.tsx')> | null = null;

/** The create dialog chunk: preloaded when the '+' button is hovered or focused (bundle-preload). */
export function preloadCreateProjectDialog(): Promise<typeof import('./CreateProjectDialog.tsx')> {
  pending ??= import('./CreateProjectDialog.tsx').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export const LazyCreateProjectDialog = lazy(() => preloadCreateProjectDialog().then((module) => ({ default: module.CreateProjectDialog })));
