import { useEffect, useRef } from 'react';

import type { Camera } from './camera';

/** Test-only API installed on the window in the `test` build mode. */
export interface Vidi6TestApi {
  setCamera(camera: Camera): void;
  setCamera(x: number, y: number, zoom: number): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

interface CameraAccess {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

/**
 * Installs `window.__vidi6` so E2E tests can jump the camera a long way in one
 * step — dragging a million pixels is impractical (design "Fixtures").
 *
 * The `import.meta.env.MODE` check is written out at every call site so Vite can
 * constant-fold it to `false` and drop the hook from production builds entirely.
 */
export function useTestCameraHook(access: CameraAccess): void {
  const accessRef = useRef(access);
  accessRef.current = access;

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;

    window.__vidi6 = {
      setCamera: (first: Camera | number, y?: number, zoom?: number) => {
        const camera: Camera =
          typeof first === 'number'
            ? { x: first, y: y ?? 0, zoom: zoom ?? 1 }
            : { x: first.x, y: first.y, zoom: first.zoom };
        accessRef.current.setCamera(camera);
      },
      getCamera: () => accessRef.current.getCamera(),
    };

    return () => {
      delete window.__vidi6;
    };
  }, []);
}
