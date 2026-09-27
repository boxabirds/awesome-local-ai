import { lazy } from 'react';

let pending: Promise<typeof import('./RescheduleConfirm.tsx')> | null = null;

/** The confirmation chunk: preloaded when the Reschedule button is hovered or focused (bundle-preload). */
export function preloadRescheduleConfirm(): Promise<typeof import('./RescheduleConfirm.tsx')> {
  pending ??= import('./RescheduleConfirm.tsx').catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export const LazyRescheduleConfirm = lazy(() => preloadRescheduleConfirm().then((module) => ({ default: module.RescheduleConfirm })));
