import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /**
   * What this page's board says about its connection right now. An e2e test
   * that watches the badge watches what a person sees; a test that needs the
   * state itself (the nightly idle run, where the badge is only up for two
   * seconds of a 45-second wait) reads it here.
   */
  connectionState(): ConnectionState;
  /**
   * Lose this page's link to the board for `ms` milliseconds, then let it come
   * back by itself. An end-to-end outage has to be a closed socket, which is not
   * what a browser's "offline" switch does to one that is already open; see
   * `sync/emulateOutage.ts`.
   */
  emulateOutage(ms: number): void;
  /**
   * Put `count` notes on this page's board in one transaction. A persistence test
   * has to fill a board to its tested size (PERSIST_TESTED_NOTES) before it can
   * check the board comes back; two thousand double-clicks is not how to do that.
   * Test builds only.
   */
  seedNotes(count: number): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs the e2e test hook `window.__vidi6` used to jump the camera far
 * away (dragging a million pixels in e2e is impractical). Guarded by the
 * Vite build mode so `vite build` (production) tree-shakes this away and the
 * hook does not exist in production builds.
 */
export function installTestHooks(setCamera: (camera: Camera) => void, getCamera: () => Camera): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
    setCamera,
    getCamera,
    connectionState: () => reported,
    emulateOutage: (ms: number) => outage?.(ms),
    seedNotes: (count: number) => seed?.(count),
  };
  }
}

// The board hands its own way to lose the link over here; see `setOutageHandler`.
let outage: ((ms: number) => void) | undefined;

// And the board's way to fill itself with notes; see `setSeedNotesHandler`.
let seed: ((count: number) => void) | undefined;

// The board reports its connection state here as it changes; see
// `reportConnectionState`. One board per page, so one value per page.
let reported: ConnectionState = 'connecting';

/**
 * Records the board's current connection state for `window.__vidi6` to hand to
 * a test. Test builds only: in any other build the hook was never installed and
 * this keeps a value nothing reads.
 */
export function reportConnectionState(state: ConnectionState): void {
  if (import.meta.env.MODE === 'test') reported = state;
}

/**
 * Hands the board's way to drop its link to `window.__vidi6`. Test builds only,
 * for the same reason as the rest of the hooks: an app never drops its own link.
 */
export function setOutageHandler(handler: (ms: number) => void): void {
  if (import.meta.env.MODE === 'test') outage = handler;
}

/**
 * Hands the board's way to seed notes to `window.__vidi6`. Test builds only, for
 * the same reason as the rest of the hooks: a real board is filled by people, not
 * by a test seam.
 */
export function setSeedNotesHandler(handler: (count: number) => void): void {
  if (import.meta.env.MODE === 'test') seed = handler;
}
