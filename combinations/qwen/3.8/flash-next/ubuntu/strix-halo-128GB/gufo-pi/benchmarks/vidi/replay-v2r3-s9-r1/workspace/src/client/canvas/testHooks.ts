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
      /** Current connection state for e2e tests. */
      connectionState?: string;
      /** Currently selected object ids (test mode). */
      getSelectedIds?(): string[];
      /** Active pointer tool: select or text (story 9, test mode). */
      getTool?(): 'select' | 'text';
      setTool?(tool: 'select' | 'text'): void;
      /** Id of the object currently open for text editing (story 9, test mode). */
      getEditingId?(): string | null;
    };
  }
}

/** Expose the board to Playwright, but only in the `test` build mode. */
export function registerTestHooks(hooks: Omit<NonNullable<Window['__vidi6']>, 'connectionState'>): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { ...window.__vidi6, ...hooks };
  }
}
