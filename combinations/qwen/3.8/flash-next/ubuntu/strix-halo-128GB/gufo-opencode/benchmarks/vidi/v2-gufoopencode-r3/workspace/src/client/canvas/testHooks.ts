import type * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../shared/board-model';
import type { SyncStatus } from '../sync/connectBoard';
import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getNotes(): readonly StickySnapshot[];
      connectionState(): SyncStatus | 'offline';
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
    connectionState: () => (connection === null ? 'offline' : connection.status())
  };
}
