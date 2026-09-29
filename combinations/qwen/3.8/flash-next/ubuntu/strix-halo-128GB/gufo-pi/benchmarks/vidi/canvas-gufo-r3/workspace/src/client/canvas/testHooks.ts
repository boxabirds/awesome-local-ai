import { Camera } from './camera';
import type { ConnectionState } from '@client/sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getCamera?(): Camera | undefined;
      /** Latest mapped connection state (test builds only; used by nightly TC-29). */
      connectionState?: ConnectionState;
      /** Live board doc (test builds only). */
      doc?: unknown;
      boardId?: string | null;
    };
  }
}

export function setupTestHooks(
  setCamera: (cam: Camera) => void,
  getCamera?: () => Camera,
  getters?: { getDoc?: () => unknown; getBoardId?: () => string | null },
) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera,
      getCamera,
      get doc() {
        return getters?.getDoc?.();
      },
      get boardId() {
        return getters?.getBoardId?.() ?? null;
      },
    };
  }
}

/** Publish the current connection state to the test hooks (no-op outside test builds). */
export function setTestConnectionState(state: ConnectionState) {
  if (import.meta.env.MODE === 'test' && window.__vidi6) {
    window.__vidi6.connectionState = state;
  }
}
