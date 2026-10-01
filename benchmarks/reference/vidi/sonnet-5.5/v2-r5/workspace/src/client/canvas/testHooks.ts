import type { Camera } from './camera';

export interface TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  connectionState?: string;
}

declare global {
  interface Window { __vidi6?: TestHooks }
}

// Only installed in test-mode builds; dead-code eliminated from production builds.
export function installTestHooks(hooks: TestHooks): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = hooks;
  return () => { delete window.__vidi6; };
}
