import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './msw';

// Unhandled requests fail the test: component tests never reach a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (typeof window !== 'undefined') {
    // Fresh app state per test: query cache, in-memory opens, link-saved flags.
    const [{ queryClient }, { resetBootOpenForTests }, { resetLinkSavedCacheForTests }] = await Promise.all([
      import('@/lib/queryClient'),
      import('@/features/workspace/bootOpen'),
      import('@/features/share/linkSaved'),
    ]);
    queryClient.clear();
    resetBootOpenForTests();
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // A test replaced storage with a throwing stub; restoreAllMocks puts it back.
    }
    resetLinkSavedCacheForTests();
  }
});
afterAll(() => server.close());
