import { lazy } from 'react';

type ForgetDialogModule = typeof import('./ForgetDialog.tsx');

let pending: Promise<ForgetDialogModule> | undefined;

/** One import promise for the dialog chunk; a failed load is forgotten so the next attempt retries. */
const load = (): Promise<ForgetDialogModule> => {
  pending ??= import('./ForgetDialog.tsx').catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
};

/** The forget dialog, in its own chunk (bundle-dynamic-imports). Mount it after its first open, in Suspense. */
export const LazyForgetDialog = lazy(load);

/**
 * Warms the dialog chunk (row menu open, pointerenter or focus; switcher open). Idempotent: every call
 * returns the same promise, so repeated hovers import it once.
 */
export function preloadForgetDialog(): Promise<unknown> {
  return load();
}
