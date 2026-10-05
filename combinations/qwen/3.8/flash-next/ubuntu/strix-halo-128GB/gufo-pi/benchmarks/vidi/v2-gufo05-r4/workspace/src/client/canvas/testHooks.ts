/**
 * Test-only helpers, installed only when `import.meta.env.MODE === 'test'` so
 * they are tree-shaken out of production builds. e2e uses `setCamera` to travel
 * UNBOUNDED_PAN_TESTED_EXTENT units (dragging a million pixels is impractical)
 * and `getCamera` to assert exact movement.
 */

import type { Camera } from './camera';
import type { CameraTestControls } from './useCamera';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/** True only in test builds (`vite build --mode test`). */
export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function installTestHooks(controls: CameraTestControls): () => void {
  if (!IS_TEST_MODE) return () => {};
  const api: Vidi6TestHooks = { setCamera: controls.setCamera, getCamera: controls.getCamera };
  window.__vidi6 = api;
  return () => {
    if (window.__vidi6 === api) delete window.__vidi6;
  };
}
