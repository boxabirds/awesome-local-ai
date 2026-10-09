/**
 * Test-only hooks (design "Fixtures"): `window.__vidi6.setCamera()` /
 * `.getCamera()` are installed only when the app is built with
 * `--mode test` (e2e against wrangler dev). Production builds exclude them:
 * Vite statically replaces import.meta.env.MODE with the mode string, so the
 * guard is dead code (and removed) in production.
 *
 * Story 2 adds `getBoardDoc()` (the live Y.Doc, for simulating other
 * clients' writes) and `getBoardSnapshot()` (note world positions for
 * coordinate assertions).
 */
import type * as Y from "yjs";
import type { StickySnapshot } from "../../shared/board-model";
import type { Camera } from "./camera";

interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  getBoardDoc(): Y.Doc;
  getBoardSnapshot(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(
  getCamera: () => Camera,
  setCamera: (camera: Camera) => void,
  getBoardDoc: () => Y.Doc,
  getBoardSnapshot: () => readonly StickySnapshot[],
): void {
  if (import.meta.env.MODE !== "test") return;
  window.__vidi6 = { setCamera, getCamera, getBoardDoc, getBoardSnapshot };
}
