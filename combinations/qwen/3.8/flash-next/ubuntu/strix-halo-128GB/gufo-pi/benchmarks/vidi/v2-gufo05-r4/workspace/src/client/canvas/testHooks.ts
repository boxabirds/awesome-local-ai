/**
 * Test-only helpers, installed only when `import.meta.env.MODE === 'test'` so
 * they are tree-shaken out of production builds.
 *
 * e2e uses `setCamera` to travel UNBOUNDED_PAN_TESTED_EXTENT units (dragging a
 * million pixels is impractical), `getCamera` to assert exact movement, and
 * `getBoard` to read what the document actually holds instead of guessing from
 * the screen, and `connectionState` to watch the live connection (`live.status`).
 * Hooks are registered by whoever owns the thing under test, so the viewport
 * contributes the camera and the board contributes its content and its connection.
 */

import type { StickySnapshot } from '../../shared/board-model';
import type { Camera } from './camera';
import type { CameraTestControls } from './useCamera';
import type { ConnectionState } from '../sync/connectBoard';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** The board document's content, bottom to top. */
  getBoard(): readonly StickySnapshot[];
  /** The live connection state, or undefined before the board reports one. */
  readonly connectionState: ConnectionState | undefined;
  /**
   * Close this board's socket and stop trying to reconnect, and put it back.
   *
   * e2e needs the outage to start at the socket: Chromium's offline emulation only
   * stops new requests, so an established WebSocket carries on working and nobody
   * notices anything is wrong.
   */
  dropConnection(): void;
  resumeConnection(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/** True only in test builds (`vite build --mode test`). */
export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/** The connection state the board last reported (story 3). */
let reportedConnection: ConnectionState | undefined;

const hooks: Partial<Vidi6TestHooks> = {};
// A live getter, so a test that reads `window.__vidi6.connectionState` sees the
// current value rather than the one captured at registration time.
Object.defineProperty(hooks, 'connectionState', {
  enumerable: true,
  get: () => reportedConnection
});

/**
 * Add hooks to `window.__vidi6` for as long as the caller holds them, leaving any
 * hooks registered by somebody else in place.
 */
export function registerTestHooks(
  partial: Partial<Omit<Vidi6TestHooks, 'connectionState'>>
): () => void {
  if (!IS_TEST_MODE) return () => {};
  Object.assign(hooks, partial);
  window.__vidi6 = hooks as Vidi6TestHooks;
  return () => {
    for (const key of Object.keys(partial) as (keyof Vidi6TestHooks)[]) delete hooks[key];
  };
}

/** Record the board's connection state for tests (`window.__vidi6.connectionState`). */
export function reportConnectionState(state: ConnectionState): void {
  if (!IS_TEST_MODE) return;
  reportedConnection = state;
  window.__vidi6 = hooks as Vidi6TestHooks;
}

/** The camera half of the hooks, registered by the viewport. */
export function installTestHooks(controls: CameraTestControls): () => void {
  return registerTestHooks({ setCamera: controls.setCamera, getCamera: controls.getCamera });
}
