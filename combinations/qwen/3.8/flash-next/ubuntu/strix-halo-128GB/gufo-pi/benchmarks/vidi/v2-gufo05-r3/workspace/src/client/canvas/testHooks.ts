import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera?(next: Camera): void;
      getBoard?(): readonly StickySnapshot[];
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

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}
