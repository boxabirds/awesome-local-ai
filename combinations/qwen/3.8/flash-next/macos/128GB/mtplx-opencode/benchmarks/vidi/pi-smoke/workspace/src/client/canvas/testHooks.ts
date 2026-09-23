import { type Camera, type Size } from "./camera";
import { type RefObject } from "react";
import { type CameraApi } from "./useCamera";

/**
 * Enables `window.__vidi6.setCamera()` and `window.__vidi6.getCamera()` so e2e can
 * jump the camera far away without dragging a million pixels. Only called when
 * `import.meta.env.MODE !== "production"`, so it is tree-shaken from the production
 * build.
 */
export function registerTestHook(
  apiRef: RefObject<CameraApi | null>,
  surfaceRef: RefObject<HTMLElement | null>,
  viewportRef: RefObject<Size>,
): () => void {
  const w = window as unknown as {
    __vidi6?: {
      setCamera(c: Camera): void;
      getCamera(): Camera | null;
      setViewport(w: number, h: number): void;
    };
  };
  const hook = {
    setCamera(c: Camera) {
      apiRef.current?.setCamera(c);
      void surfaceRef;
      void viewportRef;
    },
    getCamera() {
      return apiRef.current ? apiRef.current.camera : null;
    },
    setViewport(width: number, height: number) {
      viewportRef.current = { width, height };
    },
  };
  w.__vidi6 = hook;
  return () => {
    if (w.__vidi6 === hook) delete w.__vidi6;
  };
}
