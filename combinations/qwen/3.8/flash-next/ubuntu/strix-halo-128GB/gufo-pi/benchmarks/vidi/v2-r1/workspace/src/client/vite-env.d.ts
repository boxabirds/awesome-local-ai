/// <reference types="vite/client" />

import type { Camera } from './canvas/camera';

declare global {
  interface Window {
    /**
     * Test-only hook (present only in `--mode test` builds) used by the e2e
     * suite to jump to a position far from the start without dragging a
     * million pixels. See src/client/canvas/testHooks.ts.
     */
    __vidi6?: {
      setCamera(camera: Camera): void;
      getCamera(): Camera;
    };
  }
}

export {};
