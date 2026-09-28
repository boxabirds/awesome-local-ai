import type { Camera } from './camera';

/**
 * Test-only handles used by the Playwright suite to jump the camera (dragging a
 * million pixels is impractical) and check connection state. Installed only when
 * the client is built with `--mode test`, so production bundles never expose it.
 */
export interface BoardTestHooks {
  setCamera?(camera: Partial<Camera>): void;
  getCamera?(): Camera;
  connectionState?: string;
  disconnect?(): void;
  reconnect?(): void;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(hooks: {
  setCamera(camera: Partial<Camera>): void;
  getCamera(): Camera;
}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  // Merge with existing hooks (e.g. connectionState from useBoardDoc)
  const prev = window.__vidi6 ?? {};
  window.__vidi6 = { ...prev, setCamera: hooks.setCamera, getCamera: hooks.getCamera };
  return () => {
    if (window.__vidi6) {
      window.__vidi6 = { connectionState: window.__vidi6.connectionState };
    }
  };
}

export function setConnectionState(state: string): void {
  if (typeof window === 'undefined') return;
  if (!window.__vidi6) return; // only available in test builds
  window.__vidi6.connectionState = state;
}
