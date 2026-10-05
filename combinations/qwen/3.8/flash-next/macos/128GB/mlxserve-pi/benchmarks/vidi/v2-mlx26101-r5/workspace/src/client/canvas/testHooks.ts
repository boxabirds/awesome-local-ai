import type { Camera } from './camera';
import type { CameraPatch } from './useCamera';
import type { BoardStatus } from '../board/connection';

/** Test-only API mounted on `window.__vidi6` in the test build. */
export interface Vidi6TestApi {
  /** Jumps the camera somewhere else (e.g. one million units from the start). */
  setCamera(patch: CameraPatch): void;
  /** Reads the current camera. */
  getCamera(): Camera;
  /**
   * The connection state the badge is built from (story 3). A getter, so a test reads
   * what the connection is now rather than what it was when the board last rendered.
   */
  readonly connectionState: BoardStatus;
  /**
   * Every connection state this board has been in since it was mounted, oldest first,
   * repeats left out (story 3). "Never reconnected" is a claim about the times nobody was
   * looking, so it cannot be checked by looking; this is recorded as it happens.
   */
  readonly connectionStates: readonly BoardStatus[];
  /** The board this page is on, or null when it is not on one. */
  readonly boardId: string | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

/**
 * Installs the test hook. Only ever called from code guarded by
 * `import.meta.env.MODE === 'test'`, so it is tree-shaken out of production
 * builds.
 */
export function registerTestHooks(api: Vidi6TestApi): () => void {
  window.__vidi6 = api;
  return () => {
    if (window.__vidi6 === api) delete window.__vidi6;
  };
}
