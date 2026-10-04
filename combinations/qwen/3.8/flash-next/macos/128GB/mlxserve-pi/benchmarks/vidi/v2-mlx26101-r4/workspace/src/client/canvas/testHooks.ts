import type * as Y from 'yjs';

import { snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import type { Camera } from './camera';

/**
 * Declared in this module's global scope, and not re-exported from it, so that a
 * Playwright (Node) test can read `window.__vidi6` without importing browser code.
 * This is the same shape as `Vidi6TestHooks` below.
 */
declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Test-only hooks, installed only when the app is built with
 * `import.meta.env.MODE === 'test'` (`npm run build:test`). Dragging a million
 * pixels in an e2e test is impractical, so the tests jump the camera directly.
 * The call site in `cameraStore.ts` is folded away in production builds, so
 * `window.__vidi6` never exists there.
 */
export interface Vidi6TestHooks {
  /** Merge a partial camera (x, y, zoom) into the current camera. */
  setCamera(patch: Partial<Camera>): void;
  getCamera(): Camera;
  /**
   * The document the mounted board owns, or undefined while no board is mounted.
   * Tests read the board's real state here instead of guessing it from pixels.
   */
  getBoardDoc(): Y.Doc | undefined;
  /** The notes of the mounted board, in stacking order, read from the document. */
  getStickies(): readonly StickySnapshot[];
}

/** The document of whichever board is mounted; one at a time in a test. */
let boardDoc: Y.Doc | undefined;

/** Called by `useBoardDoc` when a board mounts (and with undefined when it goes). */
export function registerBoardForTests(doc: Y.Doc | undefined): void {
  boardDoc = doc;
}

export function installTestHooks(
  hooks: Omit<Vidi6TestHooks, 'getBoardDoc' | 'getStickies'>,
): void {
  window.__vidi6 = {
    getBoardDoc: (): Y.Doc | undefined => boardDoc,
    getStickies: (): readonly StickySnapshot[] => (boardDoc ? snapshot(boardDoc) : []),
    ...hooks,
  };
}
