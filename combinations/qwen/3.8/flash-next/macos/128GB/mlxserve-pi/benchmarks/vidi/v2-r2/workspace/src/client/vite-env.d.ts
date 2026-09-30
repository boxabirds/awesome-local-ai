/// <reference types="vite/client" />

import type { Camera } from './canvas/camera';

/**
 * Test-only hooks, installed on `window` only in the `test` build
 * (`vite build --mode test`). Production builds dead-code-eliminate the
 * assignment, so the hook does not exist there.
 */
export interface Vidi6TestApi {
  /** Jump the board camera to an exact position, e.g. far from the start. */
  setCamera(x: number, y: number, zoom: number): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }

  /** Safari's non-standard gesture events (pinch on trackpads). */
  interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
    readonly clientX: number;
    readonly clientY: number;
  }
}

export type { Camera };
