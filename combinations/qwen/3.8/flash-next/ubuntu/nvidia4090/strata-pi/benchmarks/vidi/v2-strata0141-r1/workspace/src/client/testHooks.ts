import type { Camera } from './canvas/camera';

export interface Vidi6TestHooks {
  /** Jump the camera anywhere on the board (used by e2e "far travel" tests). */
  setCamera(camera: Camera): void;
  /** Read the current camera. */
  getCamera(): Camera | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

type CameraApi = {
  set: (camera: Camera) => void;
  get: () => Camera;
};

let cameraApi: CameraApi | null = null;

/** Called by useCamera while mounted; pass null on unmount. */
export function registerCameraApi(api: CameraApi | null): void {
  cameraApi = api;
}

/** Installs `window.__vidi6` only in the test build (never in production). */
export function installTestHooks(): void {
  if (import.meta.env.MODE !== 'test') {
    return;
  }
  window.__vidi6 = {
    setCamera: (camera) => cameraApi?.set(camera),
    getCamera: () => cameraApi?.get() ?? null,
  };
}
