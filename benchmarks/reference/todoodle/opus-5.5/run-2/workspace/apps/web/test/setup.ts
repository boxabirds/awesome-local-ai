import '@testing-library/jest-dom/vitest';
import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './msw';

/**
 * Default WebSocket for component tests: it never connects, closes or delivers anything, so
 * workspace screens don't reach a network. Live tests install mock-socket's WebSocket instead.
 */
export class IdleWebSocket {
  static instances: IdleWebSocket[] = [];
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  readyState = 0;
  constructor(readonly url: string) {
    IdleWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

function installIdleWebSocket() {
  IdleWebSocket.instances = [];
  if (typeof window !== 'undefined') {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: IdleWebSocket });
  }
}
installIdleWebSocket();

// Unhandled requests fail the test: component tests never reach a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  server.events.removeAllListeners();
  toast.dismiss();
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  installIdleWebSocket();
  if (typeof window !== 'undefined') {
    // Fresh app state per test: query cache, in-memory opens, link-saved flags.
    const [
      { queryClient },
      { resetBootOpenForTests },
      { resetLinkSavedCacheForTests },
      { resetHoverNoneForTests },
      { networkMonitor },
      { canEditStore },
    ] = await Promise.all([
      import('@/lib/queryClient'),
      import('@/features/workspace/bootOpen'),
      import('@/features/share/linkSaved'),
      import('@/lib/useHoverNone'),
      import('@/features/live/network'),
      import('@/features/live/canEdit'),
    ]);
    queryClient.clear();
    // Online again, as after a page load.
    networkMonitor.reset(true);
    canEditStore.setSocketStatus('open');
    onlineManager.setOnline(true);
    resetBootOpenForTests();
    resetHoverNoneForTests();
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
