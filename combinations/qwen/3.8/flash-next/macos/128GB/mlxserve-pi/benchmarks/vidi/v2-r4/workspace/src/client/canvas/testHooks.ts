import { useEffect, useRef } from 'react';

import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

/** Test-only API installed on the window in the `test` build mode. */
export interface Vidi6TestApi {
  setCamera(camera: Camera): void;
  setCamera(x: number, y: number, zoom: number): void;
  getCamera(): Camera;
  /** The connection state the badge is showing, while the board is mounted. */
  connectionState?: ConnectionState;
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

/**
 * Keeps `window.__vidi6.connectionState` pointing at the state the badge is
 * showing, so an E2E test can watch the connection itself and not only the
 * pixels (TC-29 asserts it never leaves `connected` while idle).
 *
 * `useTestCameraHook` is installed first by `App`, so the object is normally
 * there already; `??=` covers a board mounted without it. Only this field is
 * removed on unmount, so the camera hook keeps its own.
 */
export function useTestConnectionHook(state: ConnectionState): void {
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;

    const api = (window.__vidi6 ??= {} as Vidi6TestApi);
    api.connectionState = state;

    return () => {
      delete api.connectionState;
    };
  }, [state]);
}
