import { QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { type Location, MemoryRouter, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AppRoutes } from '@/App';
import { queryClient } from '@/lib/queryClient';

/** The router's current location, updated on every render (to assert navigation, or its absence). */
export const currentLocation: { value?: Location } = {};

function LocationProbe() {
  currentLocation.value = useLocation();
  return null;
}

export function Providers({ children, entry }: { children: ReactNode; entry: string | { pathname: string; hash?: string; state?: unknown } }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

/**
 * Renders the real route table at `path` (e.g. '/w#secret' or '/w/ID'), with optional history state.
 * Async act: under React 19, a use() suspension that happens inside a synchronous act() render is
 * never retried once the promise settles, so the initial render must go through async act.
 */
export async function renderApp(path: string, opts: { state?: unknown } = {}) {
  const url = new URL(path, 'http://x');
  const entry = { pathname: url.pathname, hash: url.hash, state: opts.state };
  const user = userEvent.setup();
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Providers entry={entry}>
        <AppRoutes />
      </Providers>,
    );
  });
  return { user, ...result };
}
