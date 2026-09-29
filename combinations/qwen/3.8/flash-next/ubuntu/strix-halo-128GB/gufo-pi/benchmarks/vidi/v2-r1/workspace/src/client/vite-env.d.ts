/// <reference types="vite/client" />

import type { Vidi6TestHooks } from './canvas/testHooks';

declare global {
  interface Window {
    /**
     * Test-only hooks (present only in `--mode test` builds): the e2e suite uses
     * them to jump the camera far from the start and to read the board document.
     * See src/client/canvas/testHooks.ts.
     */
    __vidi6?: Vidi6TestHooks;
  }
}

export {};
