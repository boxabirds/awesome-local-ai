// Test-only hooks (story 1 fixture + story 2).
// Installed only when import.meta.env.MODE === 'test' (vitest and the e2e
// dev server run with --mode test), so they are excluded from production
// builds.

import type * as Y from 'yjs';
import type { Camera } from './canvas/camera';

export interface Vidi6NoteInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

export interface Vidi6TestHooks {
  /** The in-memory board document. */
  readonly doc: Y.Doc;
  getCamera(): Camera;
  setCamera(cam: Camera): void;
  /** Current notes (id, world top-left, colour, text, stacking z). */
  getNotes(): Vidi6NoteInfo[];
  /** Current connection state. */
  getConnectionState(): string;
  /** Create a note at the center of the viewport. */
  createNote(): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}
