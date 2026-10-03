import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(camera: Camera): void;
    };
  }
}

type SetCamera = (camera: Camera) => void;

let setCameraImpl: SetCamera | null = null;

/** Register the active camera setter (one live useCamera instance at a time). */
export function registerSetCamera(impl: SetCamera | null): void {
  setCameraImpl = impl;
}

// Test-only hook, enabled only when the app is built (or served) in test mode.
// Vite substitutes import.meta.env.MODE at build time, so this branch is dead
// code in production builds.
if (import.meta.env.MODE === 'test') {
  window.__vidi6 = {
    setCamera(camera: Camera) {
      setCameraImpl?.(camera);
    },
  };
}

export {};
