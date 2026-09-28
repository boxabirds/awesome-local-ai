import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

/**
 * Test-only hooks, enabled only when the client is built with
 * `import.meta.env.MODE === 'test'` (`npm run build:test`). In a production
 * build the condition folds to false and this code is dropped.
 *
 * `window.__vidi6.setCamera(x, y, zoom)` lets tests jump to a location far
 * from the start (dragging a million pixels in e2e is impractical).
 * `getNotes()` and `deleteNote(id)` let tests read the board document and
 * reproduce contract errors (a note deleted under an in-flight interaction)
 * that no user gesture can cause.
 */

export interface Vidi6TestApi {
  /** Installed by the camera provider. */
  setCamera?(x: number, y: number, zoom: number): void;
  getCamera?(): Camera | null;
  /** Board document contents, in render order. */
  getNotes?(): StickySnapshot[];
  /** Delete a note through the board model, as a remote peer would. */
  deleteNote?(id: string): boolean;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export interface CameraTestBridge {
  get(): Camera;
  set(cam: Camera): void;
}

export interface BoardTestBridge {
  getNotes(): readonly StickySnapshot[];
  deleteNote(id: string): boolean;
}

/** Install `window.__vidi6`; returns a cleanup function. */
export function installCameraTestHook(bridge: CameraTestBridge): () => void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return () => {};
  const previous = window.__vidi6;
  const api: Vidi6TestApi = {
    ...(previous ?? {}),
    setCamera(x: number, y: number, zoom: number) {
      bridge.set({ x, y, zoom });
    },
    getCamera: () => bridge.get(),
  };
  window.__vidi6 = api;
  return () => {
    const current = window.__vidi6;
    if (!current) return;
    delete current.setCamera;
    delete current.getCamera;
    if (!current.getNotes && !current.deleteNote) delete window.__vidi6;
  };
}

/**
 * Add the board-document half of `window.__vidi6`, keeping whatever the camera
 * hook installed. Returns a cleanup function.
 */
export function installBoardTestHook(bridge: BoardTestBridge): () => void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return () => {};
  const api: Vidi6TestApi = {
    ...(window.__vidi6 ?? {}),
    getNotes: () => [...bridge.getNotes()],
    deleteNote: (id: string) => bridge.deleteNote(id),
  };
  window.__vidi6 = api;
  return () => {
    const current = window.__vidi6;
    if (!current) return;
    delete current.getNotes;
    delete current.deleteNote;
    if (!current.setCamera && !current.getCamera) delete window.__vidi6;
  };
}
