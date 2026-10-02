import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';
import type * as Y from 'yjs';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /** Current board objects, sorted by (z, id). */
  getNotes(): readonly StickySnapshot[];
  /** The live Y.Doc, so tests can assert document state directly. */
  getDoc(): Y.Doc;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function registerTestHooks(hooks: Vidi6TestHooks) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = hooks;
  }
}
