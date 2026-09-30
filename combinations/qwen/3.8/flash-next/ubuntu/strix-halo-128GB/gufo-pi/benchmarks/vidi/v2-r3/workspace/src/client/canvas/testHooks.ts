import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Current board snapshot, for assertions in end-to-end tests. */
      getBoard(): readonly StickySnapshot[];
    };
  }
}

/** Expose the board to Playwright, but only in the `test` build mode. */
export function registerTestHooks(hooks: Window['__vidi6']): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = hooks;
  }
}
