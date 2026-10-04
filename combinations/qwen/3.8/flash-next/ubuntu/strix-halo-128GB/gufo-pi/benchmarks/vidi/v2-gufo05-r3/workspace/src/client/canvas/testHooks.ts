import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';

declare global {
  interface Window {
    __vidi6?: {
      setCamera?(next: Camera): void;
      getBoard?(): readonly StickySnapshot[];
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
export function installBoardHook(getBoard: () => readonly StickySnapshot[]): void {
  if (!enabled()) return;
  window.__vidi6 = { ...window.__vidi6, getBoard };
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
