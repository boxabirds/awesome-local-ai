// Test-only hooks. `window.__vidi6` exists only in a `--mode test` build, so it
// is dead code (and tree-shaken out) in production builds. E2E uses setCamera to
// jump `UNBOUNDED_PAN_TESTED_EXTENT` units away: dragging a million pixels is not
// a practical test.
import type { Camera } from "./camera";

export interface Vidi6TestHooks {
  /** Replace the camera outright (jumps far away, sets an exact zoom). */
  setCamera(cam: Camera): void;
  /** Read the camera the app currently holds. */
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(api: Vidi6TestHooks): void {
  if (import.meta.env.MODE !== "test") return;
  window.__vidi6 = api;
}

export function uninstallTestHooks(): void {
  if (import.meta.env.MODE !== "test") return;
  delete window.__vidi6;
}
