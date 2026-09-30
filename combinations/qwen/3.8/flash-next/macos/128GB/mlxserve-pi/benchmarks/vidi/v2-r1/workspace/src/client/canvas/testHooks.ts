import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Test-only hooks used by the e2e suite (design: Fixtures). Registered only
 * when `import.meta.env.MODE === 'test'`, so `vite build` (production mode)
 * strips the registration and the hook is absent from the shipped bundle.
 */
export interface Vidi6TestHooks {
  /** Jump the camera anywhere on the board (dragging a million pixels in e2e
   * is impractical). Counts as a camera change. */
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** The connection state the badge is showing (null before the first one).
   * Story 3's nightly test asserts this never leaves `connected` while idle. */
  connectionState(): ConnectionState | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/** True in the build the e2e suite runs (`vite build --mode test`). */
export const IS_TEST_MODE: boolean = import.meta.env.MODE === 'test';

let lastConnectionState: ConnectionState | null = null;

/** What the badge last reported. Cheap enough to call on every change. */
export function reportConnectionState(state: ConnectionState): void {
  if (IS_TEST_MODE) lastConnectionState = state;
}

export function registerTestHooks(
  hooks: Pick<Vidi6TestHooks, 'setCamera' | 'getCamera'>,
): void {
  if (!IS_TEST_MODE) return;
  window.__vidi6 = {
    ...hooks,
    connectionState: () => lastConnectionState,
  };
}
