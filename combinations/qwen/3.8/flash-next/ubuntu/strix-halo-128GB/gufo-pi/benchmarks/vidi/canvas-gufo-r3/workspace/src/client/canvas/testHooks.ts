import { Camera } from './camera';
import type { ConnectionState } from '@client/sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getCamera?(): Camera | undefined;
      /** Latest mapped connection state (test builds only; used by nightly TC-29). */
      connectionState?: ConnectionState;
    };
  }
}

export function setupTestHooks(setCamera: (cam: Camera) => void, getCamera?: () => Camera) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera, getCamera };
  }
}

/** Publish the current connection state to the test hooks (no-op outside test builds). */
export function setTestConnectionState(state: ConnectionState) {
  if (import.meta.env.MODE === 'test' && window.__vidi6) {
    window.__vidi6.connectionState = state;
  }
}
