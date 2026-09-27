import { useEffect, useRef } from 'react';
import type { Camera } from './camera';
import type { CameraApi } from './useCamera';

/**
 * Test-only hook (design "Fixtures"). It lets the e2e suite jump the camera to
 * an extreme position instead of dragging a million pixels, and read the camera
 * back for pixel-math assertions.
 *
 * The body is guarded by a build-time constant, so the whole registration —
 * including the `__vidi6` global — is dead-code-eliminated from production
 * builds. `npm run test:e2e` builds with `--mode test`.
 */
export interface Vidi6TestApi {
  setCamera(partial: Partial<Camera>): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export function useTestHooks(api: CameraApi): void {
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6 = {
      setCamera: (partial) => apiRef.current.setCamera({ ...apiRef.current.camera, ...partial }),
      getCamera: () => apiRef.current.camera,
    };
    return () => {
      delete window.__vidi6;
    };
  }, []);
}
