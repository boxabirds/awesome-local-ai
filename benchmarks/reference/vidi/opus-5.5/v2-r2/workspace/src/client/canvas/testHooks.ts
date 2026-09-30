import type { StickySnapshot } from '../../shared/board-model';
import type { Camera } from './camera';

export interface Vidi6TestHooks {
  /** Jump the camera anywhere (e.g. 1,000,000 units away); test builds only. */
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** Current sticky notes in the board document. */
  getNotes?(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs (merges) hooks into `window.__vidi6` in test mode only.
 * `import.meta.env.MODE` is replaced at build time, so production builds drop
 * this code entirely. Returns an uninstall function.
 */
export function installTestHooks(hooks: Partial<Vidi6TestHooks>): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = { ...window.__vidi6, ...hooks } as Vidi6TestHooks;
  return () => {
    const current = window.__vidi6 as Partial<Vidi6TestHooks> | undefined;
    if (!current) return;
    for (const key of Object.keys(hooks) as (keyof Vidi6TestHooks)[]) {
      if (current[key] === hooks[key]) delete current[key];
    }
    if (Object.keys(current).length === 0) delete window.__vidi6;
  };
}
