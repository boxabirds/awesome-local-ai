import type { Camera } from './camera';
import type { StickySnapshot, CombinedSnapshot } from '../../shared/board-model';

/**
 * Test-only hooks. Enabled only when the app is built/run in `test` mode
 * (`vite build --mode test`, Vitest), so they are dead-code-eliminated from
 * production builds. Used by the component and e2e suites to jump the camera long distances
 * (dragging a million pixels is impractical), to read the live camera state, and to read the
 * board model (so a drag can be asserted in world units, not just on screen).
 */
export interface BoardTestHooks {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Sticky notes as the model sees them, sorted by `(z, id)`. */
  getStickyNotes(): readonly StickySnapshot[];
  /** All objects (sticky + text) as the model sees them, sorted by `(z, id)`. */
  getAllObjects(): readonly CombinedSnapshot[];
  /** Current connection state (story 3). */
  connectionState?: string;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export const TEST_HOOKS_ENABLED: boolean = import.meta.env.MODE === 'test';

export function installTestHooks(api: Partial<BoardTestHooks>): void {
  if (!TEST_HOOKS_ENABLED) return;
  // Merged, so the camera (installed by `useCamera`) and the model (installed by `App`) can
  // each add their part without clobbering the other.
  window.__vidi6 = { ...(window.__vidi6 as BoardTestHooks), ...api };
}

export function uninstallTestHooks(): void {
  if (!TEST_HOOKS_ENABLED) return;
  delete window.__vidi6;
}
