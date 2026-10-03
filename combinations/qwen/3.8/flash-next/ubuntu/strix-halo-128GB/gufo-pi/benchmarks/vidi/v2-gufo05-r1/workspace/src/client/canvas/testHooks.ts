/**
 * Test-only bridge used by the e2e suite to jump the camera to a location far
 * from the start (dragging a million pixels is impractical).
 *
 * `IS_TEST_MODE` is a build-time constant, so the whole branch is removed from
 * production bundles.
 */
import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

export interface Vidi6TestApi {
  /** Move the camera immediately; values are validated, invalid input ignored. */
  setCamera(camera: Partial<Camera>): void;
  getCamera(): Camera;
  /**
   * What `connectBoard` mapped last, so a test can watch the connection without
   * reading the badge (TC-29 checks the state and the badge against each other).
   */
  connectionState?: ConnectionState;
  /**
   * Cut and restore the provider's connection. A test that wants to see what a
   * dead Wi-Fi looks like to the board needs a close event, which `setOffline`
   * alone does not produce promptly.
   */
  goOffline?(): void;
  goOnline?(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/**
 * Add to the bridge. Several modules contribute to it — the viewport the camera,
 * the connection its state — so each one merges its part in rather than replacing
 * the whole object, whichever mounted first.
 */
export function installTestHooks(api: Partial<Vidi6TestApi>): void {
  window.__vidi6 = { ...window.__vidi6, ...api } as Vidi6TestApi;
}

/** Record the mapped connection state, for a test that is watching for it. */
export function setTestConnectionState(state: ConnectionState): void {
  if (!IS_TEST_MODE) return;
  installTestHooks({ connectionState: state });
}

export function isValidCamera(value: unknown): value is Camera {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, zoom } = value as Partial<Camera>;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof zoom === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(zoom) &&
    zoom > 0
  );
}
