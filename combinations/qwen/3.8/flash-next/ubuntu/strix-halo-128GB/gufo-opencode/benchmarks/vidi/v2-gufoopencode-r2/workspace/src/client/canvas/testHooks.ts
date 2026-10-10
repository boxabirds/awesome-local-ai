import type { Camera } from './camera';
import type * as Y from 'yjs';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import type { UndoController } from '../board/undo';

export interface BoardTestHooks {
  doc: Y.Doc;
  getNotes(): readonly StickySnapshot[];
  /** Registered-type snapshot for story 9+ object assertions (e2e only). */
  getObjectSnapshots?(): readonly ObjectSnapshot[];
  /** Seeded, realistic board mutations (persistence e2e only). */
  seedBoard(count: number): void;
  /** Per-tab undo controller (story 8 e2e only). */
  undo?: UndoController;
}

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  board?: BoardTestHooks;
  connectionState?: () => ConnectionState;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

// Test-only hooks used by e2e and component tests to read and drive app state.
// Guarded by import.meta.env.MODE so they are dead-code eliminated from
// production builds (call sites check the mode before importing/calling).
export function installTestHook(hooks: Partial<Vidi6TestHooks>): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { ...window.__vidi6, ...hooks } as Vidi6TestHooks;
  }
}
