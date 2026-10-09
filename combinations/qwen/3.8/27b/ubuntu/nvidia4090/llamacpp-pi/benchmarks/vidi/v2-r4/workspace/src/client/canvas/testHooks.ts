/**
 * Test-only hooks (design "Fixtures"): `window.__vidi6.setCamera()` /
 * `.getCamera()` are installed only when the app is built with
 * `--mode test` (e2e against wrangler dev). Production builds exclude them:
 * Vite statically replaces import.meta.env.MODE with the mode string, so the
 * guard is dead code (and removed) in production.
 */
import type { Camera } from "./camera";

interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(
  getCamera: () => Camera,
  setCamera: (camera: Camera) => void,
): void {
  if (import.meta.env.MODE !== "test") return;
  window.__vidi6 = { setCamera, getCamera };
}
