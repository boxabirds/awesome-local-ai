import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { clearLinkSavedCache } from '@/features/share/linkSaved';
import { resetOpensForTests } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { server } from './msw.ts';
import { stopRecordingRequests } from './support/fixtures.ts';

// Any request without a handler fails the test: component tests never reach a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  stopRecordingRequests();
  cleanup();
  queryClient.clear();
  resetOpensForTests();
  localStorage.clear();
  sessionStorage.clear();
  clearLinkSavedCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
