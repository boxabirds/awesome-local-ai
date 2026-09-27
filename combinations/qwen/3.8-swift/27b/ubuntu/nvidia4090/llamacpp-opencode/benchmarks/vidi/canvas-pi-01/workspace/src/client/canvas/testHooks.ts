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
  /** Create a sticky note centred on a world point (e2e fixtures). */
  createNoteAt(x: number, y: number): string;
  /** board-model deleteObjects (component tests, TC-37/TC-16). */
  deleteNote(id: string): boolean;
  /** Mapped connection state (e2e: badge + reconnect assertions, TC-27/29). */
  connectionState: string;
  /** Force a connection state (story 7: load_failed disables editing). */
  setConnectionState(state: string): void;
  /** Count of transform gestures that started/ended on this client. */
  getGestureLog(): { starts: number; ends: number };
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
