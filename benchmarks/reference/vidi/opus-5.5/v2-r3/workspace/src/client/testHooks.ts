import type * as Y from 'yjs';
import type { Camera } from './canvas/camera';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /** The board document (story 2), for tests that inspect or mutate notes directly. */
  doc: Y.Doc;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs `window.__vidi6` for e2e tests. Callers guard with
 * `import.meta.env.MODE === 'test'` so production builds drop this code.
 */
export function installTestHooks(hooks: Vidi6TestHooks): () => void {
  window.__vidi6 = hooks;
  return () => {
    if (window.__vidi6 === hooks) delete window.__vidi6;
  };
}
