// Test-only hook: window.__vidi6 to drive/inspect the app from tests
// (camera jumps for e2e fixtures, model access for component tests,
// see spec Fixtures). Enabled only in test mode; the guard is statically
// replaced in production builds so the hook is excluded from them.

import * as Y from 'yjs';
import type { Camera } from './camera';

export interface Vidi6TestApi {
  setCamera(cam: Camera): void;
  /** The app's Y.Doc (component tests assert against the real document). */
  getDoc(): Y.Doc;
  /** board-model deleteObject (component tests, TC-37). */
  deleteNote(id: string): boolean;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export function installTestHooks(api: Vidi6TestApi): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = api;
  }
}
