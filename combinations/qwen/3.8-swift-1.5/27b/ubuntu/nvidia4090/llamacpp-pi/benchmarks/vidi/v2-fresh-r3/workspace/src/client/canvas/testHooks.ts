import { Camera } from './camera';
import * as Y from 'yjs';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getDoc(): Y.Doc;
  /** TEST-ONLY: create `n` sticky notes in a grid; returns their ids. */
  createNotes(n: number): string[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

let setCameraFn: ((cam: Camera) => void) | null = null;

export function registerSetCamera(fn: (cam: Camera) => void) {
  setCameraFn = fn;
}

/**
 * Registers test hooks on `window.__vidi6` (merged, so BoardViewport and App
 * each register their half). Available in all builds so e2e tests can drive
 * the production build via `wrangler dev`.
 */
export function registerVidi6Hook(partial: Partial<Vidi6TestHooks>): void {
  if (typeof window === 'undefined') return;
  window.__vidi6 = {
    setCamera: (cam) => setCameraFn?.(cam),
    getDoc: () => {
      throw new Error('getDoc test hook not registered');
    },
    createNotes: () => {
      throw new Error('createNotes test hook not registered');
    },
    ...window.__vidi6,
    ...partial,
  };
}
