import * as Y from 'yjs';
import type { Camera } from './camera';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Test-only handle on the running board, enabled only when the bundle is built in
 * `test` mode (`vite build --mode test`, used by Playwright, and Vitest). Production
 * builds (`npm run build`) exclude it entirely.
 */
export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export interface Vidi6TestHooks {
  /** Jump the camera somewhere else, e.g. UNBOUNDED_PAN_TESTED_EXTENT units away. */
  setCamera(cam: Camera): void;
  /** Read the current camera. */
  getCamera(): Camera;
  /** The board document, so a test can call the board model the app does. */
  getDoc(): Y.Doc;
  /** The notes in the document, in render order. */
  getNotes(): readonly StickySnapshot[];
  /** Every object in the document, notes and text alike, in render order (story 9). */
  getObjects(): readonly ObjectSnapshot[];
  /** What `connectBoard` currently reports about the live connection (story 3). */
  connectionState(): ConnectionState;
  /**
   * The document's state vector, as plain numbers so two tabs can be compared across page
   * boundaries: equal vectors mean everyone holds exactly the same changes (story 3).
   */
  stateVector(): number[];
  /** Creates a sticky note at the given world centre; returns its id. */
  createNote(x: number, y: number): string;
  /**
   * Creates a text object with its top-left at the given world point; returns its id, or `''`
   * when the point was not usable (story 9).
   */
  createTextAt(x: number, y: number): string;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function registerTestHooks(hooks: Vidi6TestHooks | null): void {
  if (!IS_TEST_MODE) return;
  if (hooks) {
    window.__vidi6 = hooks;
  } else {
    delete window.__vidi6;
  }
}
