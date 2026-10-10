import type * as Y from 'yjs';
import { createSticky, getStickyText, snapshot, type StickySnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import type { SyncStatus } from '../sync/connectBoard';
import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getNotes(): readonly StickySnapshot[];
      connectionState(): SyncStatus | 'offline';
      createNote(opts: { x: number; y: number; text?: string; color?: StickyColor }): string;
    };
  }
}

// Test-only hook so e2e tests can jump the camera far away without dragging
// a million pixels and read note world state. Tree-shaken out of production
// builds (MODE !== 'test').
export function installTestHooks(
  setCamera: (cam: Camera) => void,
  doc: Y.Doc,
  connection: { status(): SyncStatus } | null
): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera,
    getNotes: () => snapshot(doc),
    connectionState: () => (connection === null ? 'offline' : connection.status()),
    // Scripted bulk creation for persistence specs: goes through the exact
    // same board-model mutation path as UI actions (local origin → sync →
    // room), just without 25 rounds of toolbar choreography.
    createNote: ({ x, y, text, color }) => {
      const id = createSticky(doc, { x, y }, color ?? 'yellow');
      if (text !== undefined && text !== '') {
        const ytext = getStickyText(doc, id);
        if (ytext !== undefined) ytext.insert(0, text);
      }
      return id;
    }
  };
}
