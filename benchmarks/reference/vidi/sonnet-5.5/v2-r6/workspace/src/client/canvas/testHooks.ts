import type { Camera } from './camera';

export interface Vidi6TestHook {
  setCamera(cam: Camera): void;
}

declare global {
  interface Window { __vidi6?: Vidi6TestHook }
}

/** Installs window.__vidi6 in test builds only; the branch is removed from production builds. */
export function installTestHooks(hook: Vidi6TestHook): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = hook;
  return () => { delete window.__vidi6; };
}
