import type * as Y from 'yjs';
import type { Camera } from './camera';
import type { StickySnapshot } from '../../shared/board-model';

export interface BoardSelectionState {
  selectedId: string | null;
  editingId: string | null;
}

/**
 * Test-only API installed in `import.meta.env.MODE === 'test'` builds only.
 * Installed in pieces (camera by useCamera, board by App) and merged, so each
 * owner can register what it owns.
 */
export interface BoardTestApi {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /** Live sticky note snapshot in paint order (story 2). */
  getSnapshot(): readonly StickySnapshot[];
  /** The in-memory document, so tests can drive the model directly. */
  getDoc(): Y.Doc;
  /** Local selection / editing ids (story 2). */
  getSelection(): BoardSelectionState;
}

declare global {
  interface Window {
    __vidi6?: BoardTestApi;
  }
}

export function installTestHook(api: BoardTestApi): void {
  if (typeof window !== 'undefined') window.__vidi6 = api;
}

/** Add/replace part of the test API without clobbering the rest of it. */
export function patchTestHook(patch: Partial<BoardTestApi>): void {
  if (typeof window === 'undefined') return;
  window.__vidi6 = { ...(window.__vidi6 ?? {}), ...patch } as BoardTestApi;
}

export function uninstallTestHook(): void {
  if (typeof window !== 'undefined') delete window.__vidi6;
}

/** Drop only the given keys, leaving other owners' registrations in place. */
export function unpatchTestHook(keys: (keyof BoardTestApi)[]): void {
  if (typeof window === 'undefined') return;
  const api = window.__vidi6;
  if (!api) return;
  const mutable = api as Partial<BoardTestApi>;
  for (const key of keys) delete mutable[key];
  if (Object.keys(api).length === 0) delete window.__vidi6;
}
