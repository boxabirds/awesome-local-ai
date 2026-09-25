import type { ObjectSnapshot } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from './camera';

declare global {
  interface Window {
    /** Test-only hooks; present only in test builds (`--mode test`). */
    __vidi6?: {
      setCamera(cam: Camera): void;
      getNotes(): readonly ObjectSnapshot[];
      /** The client's mapped connection phase (story 3), or null locally. */
      connectionState: ConnectionState | null;
    };
  }
}

const stateRef = {
  setCamera: undefined as ((cam: Camera) => void) | undefined,
  getNotes: undefined as (() => readonly ObjectSnapshot[]) | undefined,
  connectionState: null as ConnectionState | null,
};

function publish(): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera: (cam: Camera) => stateRef.setCamera?.(cam),
    getNotes: () => stateRef.getNotes?.() ?? [],
    connectionState: stateRef.connectionState,
  };
}

/**
 * Test hook installation. The `import.meta.env.MODE === 'test'` check is
 * resolved at build time, so the hook is dead-code-eliminated from the plain
 * production build and present in vitest and the e2e build (`--mode test`).
 */
export function installTestHook(setCamera: (cam: Camera) => void): void {
  if (import.meta.env.MODE !== 'test') return;
  stateRef.setCamera = setCamera;
  publish();
}

/** Registers the note snapshot getter (board doc, story 2). */
export function installNotesHook(getNotes: () => readonly ObjectSnapshot[]): void {
  if (import.meta.env.MODE !== 'test') return;
  stateRef.getNotes = getNotes;
  publish();
}

/** Publishes the mapped connection phase (board connection, story 3). */
export function setConnectionState(phase: ConnectionState | null): void {
  if (import.meta.env.MODE !== 'test') return;
  stateRef.connectionState = phase;
  publish();
}

export function removeTestHook(): void {
  if (import.meta.env.MODE !== 'test') return;
  delete window.__vidi6;
}
