import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /** Current notes in render order (installed by App). */
  notes?(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Adds `hooks` to `window.__vidi6` in test builds only (`vite build --mode test`, Vitest).
 * `import.meta.env.MODE` is replaced at build time, so production bundles drop this code.
 * Several components each install their part. Returns an uninstall function.
 */
export function installTestHooks(hooks: Partial<Vidi6TestHooks>): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  const target = (window.__vidi6 ??= {} as Vidi6TestHooks) as unknown as Record<string, unknown>;
  Object.assign(target, hooks);
  return () => {
    const current = window.__vidi6 as unknown as Record<string, unknown> | undefined;
    if (!current) return;
    for (const [key, fn] of Object.entries(hooks)) if (current[key] === fn) delete current[key];
    if (Object.keys(current).length === 0) delete window.__vidi6;
  };
}
