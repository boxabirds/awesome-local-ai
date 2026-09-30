import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Current board snapshot, for assertions in end-to-end tests. */
      getBoard(): readonly StickySnapshot[];
      /** Create a sticky in world space with optional text/colour (test mode). */
      addSticky?(at: { x: number; y: number }, text?: string, color?: string): string;
      /** Current connection state for e2e tests. */
      connectionState?: string;
    };
  }
}

/** Expose the board to Playwright, but only in the `test` build mode. */
export function registerTestHooks(hooks: Omit<NonNullable<Window['__vidi6']>, 'connectionState'>): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { ...window.__vidi6, ...hooks };
  }
}
