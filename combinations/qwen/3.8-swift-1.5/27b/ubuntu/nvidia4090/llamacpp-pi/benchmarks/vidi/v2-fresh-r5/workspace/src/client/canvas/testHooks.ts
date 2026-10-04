import type { Camera } from './camera';

declare global {
  interface Window {
    /** Test-only hooks, present only in the `test` build mode. */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Mapped connection state; updated on every change (test builds only). */
      connectionState: string;
      /**
       * Drop the room's WebSocket (simulates a network break). Browsers do
       * not tear down established sockets on offline emulation, so the
       * flaky-Wi-Fi e2e combines this with `context.setOffline(true)` to
       * keep the provider from reconnecting during the outage.
       */
      dropConnection(): void;
    };
  }
}

function ensureHook(): Window['__vidi6'] | undefined {
  if (import.meta.env.MODE !== 'test') return undefined;
  if (!window.__vidi6) {
    window.__vidi6 = {
      setCamera: () => {},
      connectionState: 'connecting',
      dropConnection: () => {},
    };
  }
  return window.__vidi6;
}

/**
 * Install the test-only `window.__vidi6.setCamera` hook. It is only registered
 * when running in the `test` build mode, so it is absent from production builds
 * (the dead branch is removed at build time).
 */
export function installTestHook(setCamera: (cam: Camera) => void): void {
  const hook = ensureHook();
  if (hook) hook.setCamera = setCamera;
}

/**
 * Publish the mapped connection state on `window.__vidi6.connectionState`
 * (test builds only) so long-running e2e tests can assert on it.
 */
export function reportConnectionState(state: string): void {
  const hook = ensureHook();
  if (hook) hook.connectionState = state;
}
