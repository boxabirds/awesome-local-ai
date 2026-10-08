import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    /** Test-only board control (e2e); absent in production builds. */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Read one object's current model state, or undefined when absent. */
      getObject(id: string):
        | { x: number; y: number; z: number; color: string; text: string }
        | undefined;
    };
  }
}

/**
 * Installs the `window.__vidi6` test hooks, but only in test builds
 * (`vite build --mode test` / Vitest). In production builds the condition is
 * statically false, so the hooks are excluded from the bundle.
 */
export function installVidi6TestHooks(
  setCamera: (cam: Camera) => void,
  getObject: (id: string) => StickySnapshot | undefined,
): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  window.__vidi6 = {
    setCamera,
    getObject: (id) => {
      const o = getObject(id);
      return o === undefined
        ? undefined
        : { x: o.x, y: o.y, z: o.z, color: o.color, text: o.text };
    },
  };
}
