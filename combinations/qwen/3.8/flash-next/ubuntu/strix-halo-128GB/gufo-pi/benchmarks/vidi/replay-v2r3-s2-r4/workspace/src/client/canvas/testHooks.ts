import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

export interface SelectionSnapshot {
  selectedId: string | null;
  editingId: string | null;
}

/**
 * Test-only hooks (registered when MODE === 'test'). They let e2e and component
 * tests read the board and drive the model directly (for example deleting a note
 * while it is being dragged), without exposing anything in production builds.
 */
export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  getObjects(): readonly StickySnapshot[];
  getSelection(): SelectionSnapshot;
  /** Model-level delete, as another client or story 3/4 code would do. */
  deleteObject(id: string): boolean;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function registerTestHooks(hooks: Vidi6TestHooks): void {
  // Registered in the test build and in `vite dev`; never in a production build.
  if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
    window.__vidi6 = hooks;
  }
}
