import type { Camera } from './camera';
import type { AnySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera?(next: Camera): void;
      getBoard?(): readonly AnySnapshot[];
      /**
       * Merge a Yjs update into the live board (test builds only).
       *
       * The bytes arrive as a plain array because that is what survives the trip into
       * the page; they are the encoded state of a document the test built with the real
       * model functions.
       */
      applyUpdate?(bytes: number[]): void;
      /** Current mapped connection state (test builds only). */
      connectionState?: ConnectionState;
      /** Every connection state this tab has been in, oldest first. */
      connectionLog?: { state: ConnectionState; at: number }[];
    };
  }
}

const enabled = () => import.meta.env.MODE === 'test';

/**
 * Install the test-only hook `window.__vidi6.setCamera`.
 *
 * Enabled only when the Vite build mode is `test` (`vite build --mode test`),
 * so it is tree-shaken out of production builds. Used by e2e to jump far away
 * (dragging a million pixels is impractical).
 */
export function installTestHook(setCamera: (next: Camera) => void): void {
  if (!enabled()) return;
  window.__vidi6 = { ...window.__vidi6, setCamera };
}

/**
 * Install the test-only hook `window.__vidi6.getBoard`, a read-only view of the
 * board model (id, x, y, z, colour, text) so end-to-end tests can assert the
 * model as well as the screen.
 */
export function installBoardHook(getBoard: () => readonly AnySnapshot[]): void {
  if (!enabled()) return;
  window.__vidi6 = { ...window.__vidi6, getBoard };
}

/**
 * Install the test-only hook `window.__vidi6.applyUpdate`.
 *
 * Story 10's flow fixture is a real document, built in Node by the same model calls a
 * person's strokes produce. Without a door like this an e2e test could only reach that
 * state by drawing four shapes and four arrows with the mouse, which would test the
 * drawing rather than the flow. Applying an update is what any collaborating tab does,
 * so a seeded board travels to the server and to every other client the ordinary way.
 *
 * Test builds only, like every hook in this file: the production build never calls in.
 */
export function installApplyUpdate(apply: (update: Uint8Array) => void): void {
  if (!enabled()) return;
  window.__vidi6 = {
    ...window.__vidi6,
    applyUpdate: (bytes: number[]) => apply(Uint8Array.from(bytes)),
  };
}

/**
 * Record the mapped connection state on `window.__vidi6.connectionState` (plus a
 * transition log) so e2e can assert the state machine behind the badge, not just
 * the badge.
 */
export function reportConnectionState(state: ConnectionState): void {
  if (!enabled()) return;
  const hook = window.__vidi6 ?? {};
  hook.connectionState = state;
  hook.connectionLog = [...(hook.connectionLog ?? []), { state, at: Date.now() }];
  window.__vidi6 = hook;
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}
