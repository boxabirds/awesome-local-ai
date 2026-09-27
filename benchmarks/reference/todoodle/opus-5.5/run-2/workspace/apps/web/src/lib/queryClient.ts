import { notifyManager, QueryClient } from '@tanstack/react-query';
import { scheduleFrame } from './frameScheduler';

// Observers are notified once per animation frame (a burst of live events re-renders once), or
// on a zero timeout in hidden tabs so background caches and the title stay current.
notifyManager.setScheduler(scheduleFrame);

/** The app's single QueryClient. Module-level so the boot open can write to it before render. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true },
    // Never queue edits while offline (no offline editing): a mutation runs, and fails, at once.
    // The edit gate (canEdit, api.ts OfflineError) decides what may be sent.
    mutations: { networkMode: 'always' },
  },
});
