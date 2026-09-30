import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

export interface Vidi6TestHooks {
  /** Jump the camera anywhere (e.g. 1,000,000 units away); test builds only. */
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /** Current sticky notes in the board document. */
  getNotes?(): readonly StickySnapshot[];
  /** Every object of a known type in the board document (story 9: text objects). */
  getObjects?(): readonly ObjectSnapshot[];
  /** Ids of the objects selected by this client (story 7). */
  getSelection?(): string[];
  /** Adds sticky notes (top-left, optional size) in one go; returns their ids (e2e fixtures). */
  seedNotes?(notes: readonly { x: number; y: number; text?: string; color?: string; size?: number }[]): string[];
  /** Adds shapes (top-left, size, optional label); returns their ids (story 10 e2e fixtures). */
  seedShapes?(shapes: readonly { kind: string; x: number; y: number; width: number; height: number; label?: string }[]): string[];
  /** Adds arrows between endpoints (`{ kind: 'attached', objectId, fallback }` or `{ kind: 'free', x, y }`); returns ids. */
  seedConnectors?(arrows: readonly { from: unknown; to: unknown }[]): string[];
  /** Deletes objects as the Delete key does (arrows attached to them stay, freed). */
  deleteObjects?(ids: string[]): number;
  /** Current live connection state, and every state since the page loaded. */
  connectionState?: ConnectionState;
  connectionStates?: readonly ConnectionState[];
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

/**
 * Installs (merges) hooks into `window.__vidi6` in test mode only.
 * `import.meta.env.MODE` is replaced at build time, so production builds drop
 * this code entirely. Returns an uninstall function.
 */
export function installTestHooks(hooks: Partial<Vidi6TestHooks>): () => void {
  if (import.meta.env.MODE !== 'test') return () => {};
  window.__vidi6 = { ...window.__vidi6, ...hooks } as Vidi6TestHooks;
  return () => {
    const current = window.__vidi6 as Partial<Vidi6TestHooks> | undefined;
    if (!current) return;
    for (const key of Object.keys(hooks) as (keyof Vidi6TestHooks)[]) {
      if (current[key] === hooks[key]) delete current[key];
    }
    if (Object.keys(current).length === 0) delete window.__vidi6;
  };
}
