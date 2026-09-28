import type { Camera } from './camera.ts';

type Setter = (camera: Camera) => void;

let setter: Setter | null = null;

function isTestMode(): boolean {
  // import.meta.env.MODE is inlined by Vite; in a production build this branch is
  // eliminated, so the hook never ships.
  return typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
}

function installWindowHook(): void {
  if (typeof window === 'undefined' || window.__vidi6) return;
  window.__vidi6 = {
    setCamera(camera: Camera) {
      setter?.(camera);
    },
  };
}

/**
 * Register the camera setter used by the test-only window.__vidi6 hook. A no-op
 * outside test mode (TC fixtures rely on it to jump far away).
 */
export function registerCameraSetter(next: Setter): () => void {
  setter = next;
  if (isTestMode()) installWindowHook();
  return () => {
    if (setter === next) setter = null;
  };
}
