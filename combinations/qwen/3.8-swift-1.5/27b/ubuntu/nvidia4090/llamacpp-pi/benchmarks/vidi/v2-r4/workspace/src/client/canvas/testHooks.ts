import type * as Y from 'yjs';
import type { Camera } from './camera';

interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  /** The board's Y.Doc (e2e assertions on object state). */
  doc?: Y.Doc;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function installTestHooks(
  setCamera: (cam: Camera) => void,
  doc?: Y.Doc,
): void {
  const existing = window.__vidi6 ?? {};
  window.__vidi6 = { ...existing, setCamera, ...(doc ? { doc } : {}) };
}
