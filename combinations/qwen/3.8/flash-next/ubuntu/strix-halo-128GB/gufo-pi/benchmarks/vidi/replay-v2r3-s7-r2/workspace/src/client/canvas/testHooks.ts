import type { Camera } from './camera';
import type { ObjectSnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Current board snapshot, for assertions in end-to-end tests. */
      getBoard(): readonly ObjectSnapshot[];
      /** Create a sticky in world space with optional text/colour (test mode). */
      addSticky?(at: { x: number; y: number }, text?: string, color?: string): string;
      /** Ids of the currently selected objects, in creation order (story 7). */
      getSelectedIds?(): string[];
      /** Id of the object whose text is being edited, if any (story 2, story 7). */
      getEditingId?(): string | null;
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
