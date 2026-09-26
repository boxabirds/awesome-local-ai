import type { Camera } from './camera';
import { setBoardCamera } from './useCamera';
import { getTestConnectionState, getTestProvider } from '../sync/connectBoard';

declare global {
  interface Window {
    /**
     * Test-only hook (absent from production builds). Lets E2E tests jump
     * the camera to a distant location and read the mapped connection state.
     */
    __vidi6?: {
      setCamera(camera: Camera): void;
      connectionState(): 'connecting' | 'connected' | 'reconnecting' | 'confirmed';
      forceDisconnect(): void;
      resumeConnection(): void;
    };
  }
}

/**
 * Register the `window.__vidi6` test hook. Only active in `test` mode, so
 * production builds never expose it (the branch is statically eliminated).
 */
export function testHooks(): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera: (camera: Camera) => setBoardCamera(camera),
    connectionState: () => getTestConnectionState(),
    // Playwright's setOffline() is not a reliable outage in this
    // environment: it leaves already-established loopback WebSockets open,
    // and on webkit even fresh reconnection attempts get through. TC-27
    // therefore simulates the Wi-Fi dropping by closing the socket AND
    // holding the provider's reconnect loop (forceDisconnect), then
    // restoring both when the network returns (resumeConnection).
    forceDisconnect: () => {
      const provider = getTestProvider();
      if (provider === null) return;
      provider.shouldReconnect = () => false;
      provider.ws?.close();
    },
    resumeConnection: () => {
      const provider = getTestProvider();
      if (provider === null) return;
      provider.shouldReconnect = (event) => !(event.code >= 4400 && event.code < 4500);
      provider.connect();
    },
  };
}
