import { Camera } from './camera';
import * as Y from 'yjs';

export interface NoteSpec {
  /** World centre of the note. */
  x: number;
  y: number;
  color?: string;
  text?: string;
}

export interface TextSpec {
  /** World top-left of the text object. */
  x: number;
  y: number;
  text?: string;
  size?: 'S' | 'M' | 'L' | 'XL';
}

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getDoc(): Y.Doc;
  /** TEST-ONLY: create `n` sticky notes in a grid; returns their ids. */
  createNotes(n: number): string[];
  /** TEST-ONLY: create sticky notes at the given world centres; returns their ids. */
  createNotesAt(specs: NoteSpec[]): string[];
  /** TEST-ONLY: create text objects at the given world top-lefts; returns their ids. */
  createTextAt(specs: TextSpec[]): string[];
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
    createNotesAt: () => {
      throw new Error('createNotesAt test hook not registered');
    },
    createTextAt: (_specs: TextSpec[]) => {
      throw new Error('createTextAt test hook not registered');
    },
    ...window.__vidi6,
    ...partial,
  };
}
