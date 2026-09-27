import { QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { Home } from '@/routes/Home';
import { loadWorkspaceRoute } from '@/routes/lazy';
import { RecoverableNotFound } from '@/routes/RecoverableNotFound';
import { RememberedWorkspaceFallback } from '@/features/remembered/RememberedWorkspaceFallback';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';

// The Workspace route is its own chunk (bundle-dynamic-imports); Home preloads it on hover/focus.
const Workspace = lazy(loadWorkspaceRoute);

const idWorkspace = (
  <Suspense fallback={<RememberedWorkspaceFallback />}>
    <Workspace />
  </Suspense>
);

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
      <Route path="/w/:workspaceId" element={idWorkspace} />
      {/* Story 7: the same element, so moving between the Inbox and projects keeps the workspace mounted. */}
      <Route path="/w/:workspaceId/project/:projectId" element={idWorkspace} />
      {/* Story 8: Today has its own address (reload, back and forward return to it). */}
      <Route path="/w/:workspaceId/today" element={idWorkspace} />
      <Route path="*" element={<RecoverableNotFound />} />
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
