// Registers the `window.__vidi6` test hooks. Only the `test` build
// (`npm run build:test`, i.e. MODE=test) installs anything on `window`; in the
// production build the guarded block is statically false and is removed by the
// bundler, so the hook is excluded from production builds.

import type { Camera } from './camera';

export type CameraSetter = (camera: Camera) => void;

let setter: CameraSetter | null = null;

/** Called by `useCamera` on mount (and cleared on unmount). */
export function registerCameraSetter(next: CameraSetter | null): void {
  setter = next;
  if (import.meta.env.MODE === 'test' && typeof window !== 'undefined') {
    window.__vidi6 = {
      setCamera: (x: number, y: number, zoom: number) => {
        setter?.({ x, y, zoom });
      },
    };
  }
}
