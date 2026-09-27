import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { queryClient } from '@/lib/queryClient';
import { Home } from '@/routes/Home';
import { NotFound } from '@/routes/NotFound';

const Workspace = lazy(() => import('@/routes/Workspace'));

/** Route table, shared by the app and the component tests (which use a MemoryRouter). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/w" element={<LazyRoute><Workspace /></LazyRoute>} />
      <Route path="/w/:workspaceId" element={<LazyRoute><Workspace /></LazyRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceSkeleton />}>{children}</Suspense>;
}

/** Providers every screen needs. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
