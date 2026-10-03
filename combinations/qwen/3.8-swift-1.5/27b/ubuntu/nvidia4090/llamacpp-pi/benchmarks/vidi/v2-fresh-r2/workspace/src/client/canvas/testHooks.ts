import type { Camera } from './camera';

declare global {
  interface Window {
    /**
     * Test-only hook, present only in builds with MODE === 'test'. Excluded
     * from production builds by Vite's static env replacement.
     */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Current mapped connection state (see connectBoard.ConnectionState). */
      connectionState: string;
      /** Every connection-state change since load, in order. */
      connectionStateLog: string[];
      setConnectionState(state: string): void;
      /**
       * Close the board's WebSocket to simulate a network drop (used with
       * context.setOffline in the flaky-wifi e2e so reconnection fails until
       * the browser is back online).
       */
      disconnect?: () => void;
      connectionDebug?: () => { wsReadyState: number | null; wsconnected?: boolean; wsconnecting?: boolean };
    };
  }
}

export function registerTestHooks(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  const existing = window.__vidi6;
  window.__vidi6 = {
    setCamera,
    connectionState: existing?.connectionState ?? 'connecting',
    connectionStateLog: existing?.connectionStateLog ?? [],
    setConnectionState(state: string) {
      const hook = window.__vidi6;
      if (!hook) return;
      hook.connectionState = state;
      hook.connectionStateLog.push(state);
    },
  };
}

export function unregisterTestHooks(): void {
  if (import.meta.env.MODE !== 'test') return;
  delete window.__vidi6;
}

/** Wire the board connection's disconnect() into the test hook (test builds). */
export function setDisconnectHook(
  fn: (() => void) | undefined,
  debug?: (() => { wsReadyState: number | null; wsconnected?: boolean; wsconnecting?: boolean }) | undefined,
): void {
  if (import.meta.env.MODE !== 'test') return;
  const hook = window.__vidi6;
  if (hook) {
    hook.disconnect = fn;
    hook.connectionDebug = debug;
  }
}
