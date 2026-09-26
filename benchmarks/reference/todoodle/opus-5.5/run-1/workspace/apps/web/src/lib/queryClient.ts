import { QueryClient } from '@tanstack/react-query';

/** Workspace data primed from create/open counts as fresh this long, so arriving never refetches it at once. */
const DEFAULT_STALE_MS = 10_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Failures show an explicit 'Try again'; silent retries would only delay that.
      queries: { staleTime: DEFAULT_STALE_MS, retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

/** The app's single client. Boot open writes into it before React renders. */
export const queryClient = createQueryClient();
