import type { Camera } from './camera.js';

/**
 * Test-only hooks used by the Playwright and component suites. Registered only when
 * the client is built in "test" mode (`import.meta.env.MODE === 'test'`, which Vitest
 * also sets), so they do not exist in production builds.
 *
 * `getDoc` / `getSelection` let a test inspect the real Yjs document and the per-user
 * selection behind the running app, so assertions read the model rather than only DOM.
 */
export interface Vidi6TestHooks {
  setCamera(next: Camera): void;
  getCamera(): Camera;
  getDoc(): unknown;
  getSelection(): { selectedId: string | null; editingId: string | null };
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function testHooksEnabled(): boolean {
  return import.meta.env.MODE === 'test';
}

function ensure(): Vidi6TestHooks {
  window.__vidi6 ??= {
    setCamera: () => undefined,
    getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
    getDoc: () => null,
    getSelection: () => ({ selectedId: null, editingId: null }),
  };
  return window.__vidi6;
}

export function registerTestHooks(
  setCamera: (next: Camera) => void,
  getCamera: () => Camera,
): void {
  if (!testHooksEnabled() || typeof window === 'undefined') return;
  const hooks = ensure();
  hooks.setCamera = setCamera;
  hooks.getCamera = getCamera;
}

export function registerBoardTestHooks(
  getDoc: () => unknown,
  getSelection: () => { selectedId: string | null; editingId: string | null },
): void {
  if (!testHooksEnabled() || typeof window === 'undefined') return;
  const hooks = ensure();
  hooks.getDoc = getDoc;
  hooks.getSelection = getSelection;
}
