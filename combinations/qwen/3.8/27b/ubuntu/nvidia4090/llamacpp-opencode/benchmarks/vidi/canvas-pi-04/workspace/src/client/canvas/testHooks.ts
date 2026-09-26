import type { Camera } from './camera';
import { setBoardCamera } from './useCamera';

declare global {
  interface Window {
    /**
     * Test-only hook (absent from production builds). Lets E2E tests jump the
     * camera to a distant location without dragging a million pixels.
     */
    __vidi6?: {
      setCamera(camera: Camera): void;
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
  };
}
