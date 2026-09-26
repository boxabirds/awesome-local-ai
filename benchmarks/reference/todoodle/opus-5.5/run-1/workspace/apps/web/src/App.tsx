import { QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { Home } from '@/routes/Home';
import { loadWorkspaceRoute } from '@/routes/lazy';
import { NotFound } from '@/routes/NotFound';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';

// The Workspace route is its own chunk (bundle-dynamic-imports); Home preloads it on hover/focus.
const Workspace = lazy(loadWorkspaceRoute);

/** Route table, separate from the browser router so tests can mount it in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/w"
        element={
          <Suspense fallback={<WorkspaceSkeleton />}>
            <Workspace />
          </Suspense>
        }
      />
      <Route
        path="/w/:workspaceId"
        element={
          <Suspense fallback={<WorkspaceSkeleton />}>
            <Workspace />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}
