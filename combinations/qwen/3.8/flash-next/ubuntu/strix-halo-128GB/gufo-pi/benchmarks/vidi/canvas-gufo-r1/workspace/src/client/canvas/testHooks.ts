// Test-only bridge so Playwright can jump the camera far away instead of
// dragging a million pixels. Installed only when built with MODE === 'test';
// the production build tree-shakes this out (the guard is a build-time literal).

export interface BoardTestHooks {
  setCamera(x: number, y: number, zoom?: number): void;
  connectionState?: string;
  provider?: unknown;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function installTestHooks(setCamera: BoardTestHooks['setCamera']): () => void {
  if (!IS_TEST_MODE) return () => {};
  window.__vidi6 = { setCamera };
  return () => {
    delete window.__vidi6;
  };
}
