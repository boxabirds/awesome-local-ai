/**
 * Test-only helpers, installed only when `import.meta.env.MODE === 'test'` so
 * they are tree-shaken out of production builds.
 *
 * e2e uses `setCamera` to travel UNBOUNDED_PAN_TESTED_EXTENT units (dragging a
 * million pixels is impractical), `getCamera` to assert exact movement, and
 * `getBoard` to read what the document actually holds instead of guessing from
 * the screen. Hooks are registered by whoever owns the thing under test, so the
 * viewport contributes the camera and the board contributes its content.
 */

import type { StickySnapshot } from '../../shared/board-model';
import type { Camera } from './camera';
import type { CameraTestControls } from './useCamera';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** The board document's content, bottom to top. */
  getBoard(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/** True only in test builds (`vite build --mode test`). */
export const IS_TEST_MODE = import.meta.env.MODE === 'test';

const hooks: Partial<Vidi6TestHooks> = {};

/**
 * Add hooks to `window.__vidi6` for as long as the caller holds them, leaving any
 * hooks registered by somebody else in place.
 */
export function registerTestHooks(partial: Partial<Vidi6TestHooks>): () => void {
  if (!IS_TEST_MODE) return () => {};
  Object.assign(hooks, partial);
  window.__vidi6 = hooks as Vidi6TestHooks;
  return () => {
    for (const key of Object.keys(partial) as (keyof Vidi6TestHooks)[]) delete hooks[key];
  };
}

/** The camera half of the hooks, registered by the viewport. */
export function installTestHooks(controls: CameraTestControls): () => void {
  return registerTestHooks({ setCamera: controls.setCamera, getCamera: controls.getCamera });
}
