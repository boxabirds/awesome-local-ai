import { QueryClient } from '@tanstack/react-query';

/** The app's single QueryClient. Module-level so the boot open can write to it before render. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true },
  },
});
