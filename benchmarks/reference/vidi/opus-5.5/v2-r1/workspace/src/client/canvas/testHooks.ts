import type { StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

/** Test-only API exposed as `window.__vidi6` when built with `--mode test`. */
export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  getNotes(): readonly StickySnapshot[];
  /** Current mapped connection state (story 3). */
  connectionState: ConnectionState;
  /** Every connection state reported since the page loaded, in order. */
  connectionHistory: ConnectionState[];
  /** Unmounts the app (tears down the connection). */
  unmount(): void;
}

declare global {
  interface Window {
    __vidi6?: Partial<Vidi6TestHooks>;
  }
}

/** Adds `hooks` to `window.__vidi6`; the returned function removes them again. */
export function installTestHooks(hooks: Partial<Vidi6TestHooks>): () => void {
  const target = (window.__vidi6 ??= {});
  Object.assign(target, hooks);
  return () => {
    for (const key of Object.keys(hooks) as (keyof Vidi6TestHooks)[]) {
      if (target[key] === hooks[key]) delete target[key];
    }
    if (window.__vidi6 === target && Object.keys(target).length === 0) delete window.__vidi6;
  };
}
