import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { announcer } from '@/features/live/announcer';
import { clearEditGuardsForTests } from '@/features/live/editGuard';
import { setDefaultSocketFactory } from '@/features/live/LiveConnection';
import { networkMonitor } from '@/features/live/network';
import { clearLiveHandlersForTests } from '@/features/live/registry';
import { clearLinkSavedCache } from '@/features/share/linkSaved';
import { resetOpensForTests } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { server } from './msw.ts';
import { stopRecordingRequests } from './support/fixtures.ts';
import { stopLiveServers } from './support/live.ts';
import { inertSocketFactory } from './support/sockets.ts';

// Live sockets never reach a network unless a test installs a mock-socket server (story 4).
setDefaultSocketFactory(inertSocketFactory);

// Any request without a handler fails the test: component tests never reach a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  stopRecordingRequests();
  cleanup();
  // sonner keeps toasts in a global store and replays active ones to the next Toaster: dismiss them.
  toast.dismiss();
  queryClient.clear();
  resetOpensForTests();
  localStorage.clear();
  sessionStorage.clear();
  clearLinkSavedCache();
  stopLiveServers();
  setDefaultSocketFactory(inertSocketFactory);
  clearLiveHandlersForTests();
  clearEditGuardsForTests();
  announcer.reset();
  // Tests that simulate failed requests leave the app offline: every test starts online.
  networkMonitor.resetForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
