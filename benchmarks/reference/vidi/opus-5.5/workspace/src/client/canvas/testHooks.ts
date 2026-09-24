import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

/**
 * Test-only hooks exposed as `window.__vidi6`. Installed only when
 * `import.meta.env.MODE === 'test'` (Vitest, and the `build:test` bundle that e2e
 * runs against). The guarded call sites let production builds drop this module.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** Board objects as stored in the document (story 2). */
  getNotes(): readonly StickySnapshot[];
  /** The board document itself, for tests that change it the way another client would. */
  getDoc(): Y.Doc;
  /** The mapped connection state behind the status badge (story 3). */
  connectionState: ConnectionState;
}

declare global {
  interface Window {
    /** Each hook is installed by the component that owns the data (camera, board). */
    __vidi6?: Vidi6TestHooks;
  }
}

/** Adds `hooks` to `window.__vidi6`; the returned function removes exactly those hooks again. */
export function installTestHooks(hooks: Partial<Vidi6TestHooks>): () => void {
  const target: Partial<Vidi6TestHooks> = window.__vidi6 ?? {};
  Object.assign(target, hooks);
  window.__vidi6 = target as Vidi6TestHooks;
  return () => {
    const current: Partial<Vidi6TestHooks> | undefined = window.__vidi6;
    if (!current) return;
    for (const key of Object.keys(hooks) as (keyof Vidi6TestHooks)[]) {
      if (current[key] === hooks[key]) delete current[key];
    }
    if (Object.keys(current).length === 0) delete window.__vidi6;
  };
}
